# Flujo Completo: Generación de Presupuestos PDF

## Resumen

Cuando un usuario pide un presupuesto por chat (web o WhatsApp), el sistema:
1. El **Coordinator** (Emilio) detecta la intención y delega al **QuoteAgent**
2. El **QuoteAgent** consulta el catálogo de productos y recopila datos del cliente
3. La tool `calculateBudget` busca precios, genera el PDF y lo persiste
4. El PDF se almacena en la tabla `quotes` y se devuelve al usuario

---

## 1. Modelo de Datos

### 1.1 Tabla `catalogs`

```sql
CREATE TABLE catalogs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      TEXT NOT NULL,            -- orgId de la organización propietaria
  name        TEXT NOT NULL,            -- ej: "Catálogo Césped Artificial 2026"
  effective_date TIMESTAMPTZ NOT NULL,  -- fecha de vigencia
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

- **Relación con org**: un catálogo pertenece a una organización via `org_id` (string libre, no FK)
- **Activación**: solo UN catálogo activo por org (la lógica lo filtra por `is_active = true`)
- **Multi-tenant**: cada org tiene su propio catálogo con sus precios

### 1.2 Tabla `catalog_items`

```sql
CREATE TABLE catalog_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id    UUID NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  code          INTEGER NOT NULL,          -- código numérico (CODART)
  name          TEXT NOT NULL,             -- nombre del producto (aparece en el PDF)
  description   TEXT,                      -- contexto para el LLM (NO aparece en el PDF)
  category      TEXT,                      -- categoría (no usado actualmente)
  price_per_unit NUMERIC(10,2) NOT NULL,   -- precio unitario
  unit          TEXT NOT NULL,             -- unidad de medida: "m²", "km", "ud"
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(catalog_id, code)                 -- un code único por catálogo
);
```

**Campos clave**:
- `name`: Lo que aparece como "Descripción" en la línea del PDF. Es el nombre comercial del producto.
- `description`: Texto explicativo para que el LLM entienda qué es el producto. **NO** se incluye en el PDF. Solo lo ve el agente cuando llama a `listCatalog`.
- `unit`: Determina cómo se mide la cantidad. El LLM debe respetar esto.
- `price_per_unit`: Precio por unidad de medida. El cálculo es `price_per_unit × quantity`.

### 1.3 Datos actuales (seed de producción)

El catálogo se siembra automáticamente la primera vez que una org se crea (si no tiene catálogo activo):

| code | name | description | price/ud | unit |
|------|------|-------------|----------|------|
| 1 | Cesped verde | *(null en seed)* | 12,00 € | m² |
| 2 | Cesped amarillo | *(null en seed)* | 13,00 € | m² |
| 3 | Cesped premium | *(null en seed)* | 16,00 € | m² |
| 4 | Cesped premium ultimate | *(null en seed)* | 18,00 € | m² |
| 5 | Cesped v4 | *(null en seed)* | 15,00 € | m² |
| 6 | Cesped ecologico | *(null en seed)* | 16,00 € | m² |
| 7 | Mano de obra | *(null en seed)* | 10,00 € | m² |
| 8 | Desplazamiento | *(null en seed)* | 10,00 € | km |

> **Nota**: El seed no incluye `description`. Si en producción se han editado los items via el dashboard (CatalogPage), podrían tener descripciones. Esas descripciones son solo para contexto del LLM.

### 1.4 Tabla `quotes` (historial de presupuestos)

```sql
CREATE TABLE quotes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         TEXT NOT NULL,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_number   TEXT NOT NULL,              -- ej: "PRES-20260309-1234"
  client_name    TEXT NOT NULL,
  client_address TEXT,
  line_items     JSONB NOT NULL,             -- array de { description, quantity, unit, unitPrice, lineTotal }
  subtotal       NUMERIC(10,2) NOT NULL,
  vat_amount     NUMERIC(10,2) NOT NULL,
  total          NUMERIC(10,2) NOT NULL,
  pdf_base64     TEXT,                       -- PDF completo en base64
  filename       TEXT NOT NULL,              -- ej: "PRES-20260309-1234.pdf"
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

- `line_items` es JSONB con la estructura exacta que se usó para generar el PDF
- `pdf_base64` contiene el PDF entero codificado en base64 (puede ser grande: ~50-200KB por PDF)

### 1.5 Tabla `organizations` (datos de empresa para el PDF)

```sql
CREATE TABLE organizations (
  id         UUID PRIMARY KEY,
  org_id     TEXT NOT NULL UNIQUE,
  name       TEXT,          -- nombre de la empresa (cabecera del PDF)
  address    TEXT,          -- dirección (aparece en el PDF)
  phone      TEXT,          -- teléfono (aparece en el PDF)
  email      TEXT,          -- email (aparece en el PDF)
  nif        TEXT,          -- NIF/CIF (aparece en el PDF)
  logo       TEXT,          -- logo en base64 (aparece en cabecera del PDF)
  vat_rate   NUMERIC(5,4),  -- tipo IVA (ej: 0.2100 = 21%)
  currency   TEXT DEFAULT '€',
  features   JSONB,
  ...
);
```

Si la org no tiene datos configurados, se usan los defaults de `quoteConfig`:
```typescript
companyName:    "Tu Empresa S.L."
companyAddress: "Calle Ejemplo, 1 · 28001 Madrid"
companyPhone:   "+34 600 000 000"
companyNif:     "B-00000000"
companyEmail:   "info@tuempresa.com"
vatRate:        0.21
currency:       "€"
```

---

## 2. Arquitectura de Agentes

### 2.1 Cadena de delegación

```
Usuario → POST /chat → Coordinator (Emilio)
                            │
                            ├─ detecta intención de presupuesto
                            │
                            ▼
                      delegateTo_quote
                            │
                            ├─ crea RequestContext con userId + orgId
                            ├─ llama QuoteAgent.generate(query)
                            │
                            ▼
                       QuoteAgent
                            │
                            ├─ PASO 1: llama listCatalog()
                            ├─ PASO 2: pide datos faltantes al usuario
                            ├─ PASO 3: llama calculateBudget()
                            │
                            ▼
                     [PDF generado + persistido]
```

### 2.2 Coordinator (src/agent/coordinator.ts)

- Agente principal con **memoria** (Mastra Memory + PostgreSQL schema `mastra`)
- Recibe TODAS las tools de delegación: `delegateTo_rag`, `delegateTo_quote`, etc.
- **Routing**: cuando detecta intención de presupuesto → `delegateTo_quote`
- Pasa `requestContext` con `userId` y `orgId` al sub-agente

### 2.3 QuoteAgent (src/plugins/quote/quote.agent.ts)

- Agente especializado, **SIN memoria propia** (cada delegación es fresh)
- Modelo: Gemini 2.5 Flash
- Tools disponibles: `listCatalog` + `calculateBudget`
- System prompt le indica flujo obligatorio:
  1. SIEMPRE llamar `listCatalog` primero
  2. Pedir datos faltantes (nombre cliente, dirección, productos + cantidades)
  3. Usar nombres EXACTOS del catálogo en `calculateBudget`

### 2.4 Delegation Tool (src/agent/delegation.ts)

```
Coordinator → delegateTo_quote(query) → QuoteAgent.generate(query, { requestContext })
                                                                         │
                                                              userId + orgId propagados
                                                              para que las tools puedan
                                                              acceder al catálogo correcto
```

El `requestContext` se propaga del coordinator al sub-agente, y de ahí a las tools.

---

## 3. Tools del Quote Plugin

### 3.1 `listCatalog` — Consultar catálogo

**Archivo**: `src/plugins/quote/tools/list-catalog.tool.ts`

```
Input:  {} (sin parámetros)
Output: {
  success: boolean,
  catalogName: string,
  items: [{ code, name, description, pricePerUnit, unit }]
}
```

**Flujo interno**:
1. Extrae `orgId` del `requestContext`
2. Busca catálogo activo para esa org (`CatalogService.getActiveCatalogId`)
3. Si no hay catálogo para la org → fallback: cualquier catálogo activo (single-tenant convenience)
4. Devuelve TODOS los items activos con `name`, `description`, `pricePerUnit`, `unit`

**Rol de `description` aquí**: El LLM recibe la descripción para entender qué es cada producto (ej: "Césped de alta densidad para zonas de alto tráfico"). Esto le ayuda a hacer matching cuando el usuario dice algo vago como "el bueno" o "el más resistente".

### 3.2 `calculateBudget` — Calcular y generar PDF

**Archivo**: `src/plugins/quote/tools/calculate-budget.tool.ts`

```
Input: {
  clientName:    "Juan García",
  clientAddress: "Calle Mayor 5, Madrid",
  items: [
    { nameOrCode: "Cesped premium", quantity: 50 },
    { nameOrCode: "Mano de obra",   quantity: 50 },
    { nameOrCode: "Desplazamiento", quantity: 30 },
  ],
  applyVat: true
}
```

**Flujo interno paso a paso**:

```
1. Extraer orgId del requestContext
   └── Si no hay orgId → error

2. En paralelo:
   ├── Buscar org en DB (para datos de empresa del PDF)
   └── Buscar catalogId activo para la org

3. Resolver datos de empresa (resolveCompanyDetails):
   ├── Si org tiene name/address/phone/nif → usar esos
   └── Si no → usar defaults de quoteConfig

4. Para CADA item del input:
   ├── CatalogService.findItem(catalogId, nameOrCode)
   │   ├── Si nameOrCode es numérico → buscar por code exacto
   │   └── Si es texto → buscar por ILIKE accent-insensitive en name
   │
   ├── Si encontrado → crear QuoteLineItem:
   │   {
   │     description: catalogItem.name,    ← SOLO el nombre, NO la description
   │     quantity:    item.quantity,
   │     unit:        catalogItem.unit,
   │     unitPrice:   catalogItem.pricePerUnit,
   │     lineTotal:   pricePerUnit × quantity (redondeado a 2 decimales)
   │   }
   │
   └── Si NO encontrado → añadir a notFound[]

5. Calcular totales:
   subtotal = Σ lineTotal
   vatAmount = subtotal × vatRate (si applyVat)
   total    = subtotal + vatAmount

6. Generar número de presupuesto:
   "PRES-20260309-XXXX" (fecha + últimos 4 dígitos del timestamp)

7. Generar PDF (PdfService.generateQuotePdf):
   → Devuelve el PDF como string base64

8. Almacenar PDF:
   ├── En pdfStore (in-memory Map, para delivery inmediato via WhatsApp)
   ├── En attachmentStore (para que Gmail plugin pueda adjuntarlo)
   └── En tabla quotes (persistencia permanente para historial)

9. Devolver resultado al QuoteAgent:
   {
     success: true,
     clientName: "Juan García",
     lineItems: [...],
     subtotal: 930.00,
     vatAmount: 195.30,
     total: 1125.30,
     pdfGenerated: true,
     filename: "PRES-20260309-1234.pdf",
     notFound: []
   }
```

---

## 4. Generación del PDF

### 4.1 PdfService (src/plugins/quote/services/pdf.service.ts)

Usa **pdf-lib** (generación PDF pura en JS, sin dependencias nativas).

**Estructura del PDF generado**:

```
┌─────────────────────────────────────────────────┐
│  ██████████ HEADER BAR (verde) █████████████████│
│  PRESUPUESTO              [Logo org si existe]   │
│  Nº PRES-20260309-1234    9 de marzo de 2026    │
├─────────────────────────────────────────────────┤
│  GreenGrass S.L.                                 │
│  Av. de la Constitución 15, Sevilla              │
│  Tel: +34 955 123 456  ·  info@greengrass.es     │
│  NIF: B-41234567                                 │
│─────────────────────────────────────────────────│
│  CLIENTE                                         │
│  Juan García                                     │
│  Calle Mayor 5, Madrid                           │
│─────────────────────────────────────────────────│
│  Descripción       Cant.  Unidad  Precio/ud Total│
│  ─────────────────────────────────────────────── │
│  Cesped premium     50     m²     16,00 €  800,00│
│  Mano de obra       50     m²     10,00 €  500,00│
│  Desplazamiento     30     km     10,00 €  300,00│
│─────────────────────────────────────────────────│
│                              Subtotal: 1.600,00 €│
│                              IVA (21%):   336,00 €│
│                    ┌─────────────────────────────┐│
│                    │ TOTAL:          1.936,00 € ││
│                    └─────────────────────────────┘│
│                                                   │
│  Este presupuesto tiene una validez de 30 días.  │
└─────────────────────────────────────────────────┘
```

**Datos que aparecen en el PDF**:
- **Header**: título "PRESUPUESTO", número, fecha, logo de la org (si existe)
- **Empresa**: name, address, phone, email, nif — de la tabla `organizations` o defaults
- **Cliente**: clientName, clientAddress — los que proporciona el usuario al LLM
- **Tabla de productos**: `catalogItem.name` (NO la description), quantity, unit, unitPrice, lineTotal
- **Totales**: subtotal, IVA (con porcentaje), total
- **Footer**: texto de validez 30 días

### 4.2 Formato y encoding

- **Tamaño**: A4 (595 × 842 points)
- **Fuentes**: Helvetica + Helvetica Bold (embebidas en PDF por defecto)
- **Output**: `Buffer.from(pdfBytes).toString("base64")` — string base64
- **Logo**: si la org tiene logo (campo `logo` en organizations), se embebe como PNG o JPEG

---

## 5. Búsqueda de Productos (CatalogService)

### 5.1 `findItem(catalogId, nameOrCode)`

**Archivo**: `src/plugins/quote/services/catalog.service.ts`

Dos modos de búsqueda:

1. **Por código numérico**: si `nameOrCode` es solo dígitos → `WHERE code = X`
2. **Por nombre (texto)**: `ILIKE` con normalización de acentos
   ```sql
   WHERE lower(translate(name, 'áéíóú...', 'aeiou...'))
     LIKE lower('%cesped premium%')
   ```

**Importante**: devuelve solo el PRIMER match (`LIMIT 1`). Si el usuario dice "cesped" y hay 6 tipos, devuelve el primero por orden de inserción.

### 5.2 `getAllItems(catalogId)`

Devuelve TODOS los items activos ordenados por `sort_order`. Es lo que usa `listCatalog` para mostrar el catálogo completo al LLM.

### 5.3 `getActiveCatalogId(orgId)`

1. Busca catálogo activo para la org específica
2. Si no hay → fallback: cualquier catálogo activo (para deployments single-tenant)

---

## 6. Flujo Completo: Usuario pide presupuesto por chat

### Ejemplo: "Hazme un presupuesto para Juan García, Calle Mayor 5 Madrid, 50m2 de césped premium y 30km de desplazamiento"

```
PASO 1 — Frontend
  Dashboard envía POST /chat/stream?query="Hazme un presupuesto..."
  Headers: Authorization: Bearer <jwt-usuario>

PASO 2 — Chat Route (chat.routes.ts)
  Valida query con Zod
  Extrae userId + orgId del JWT
  Crea RequestContext({ userId, orgId })
  Llama coordinator.stream(query, { requestContext, memory })

PASO 3 — Coordinator (Emilio)
  Lee el mensaje, detecta intención de presupuesto
  Llama delegateTo_quote({ query: "Hazme un presupuesto..." })

PASO 4 — Delegation Tool (delegation.ts)
  Crea nuevo RequestContext con userId + orgId
  Llama QuoteAgent.generate(query, { requestContext })

PASO 5 — QuoteAgent
  System prompt dice: "SIEMPRE llama listCatalog PRIMERO"

  5a. Llama listCatalog({})
      → CatalogService busca catálogo activo para orgId
      → Devuelve 8 productos con name, description, price, unit
      → El LLM ahora sabe qué productos hay disponibles

  5b. Analiza la query del usuario:
      - clientName: "Juan García" ✓
      - clientAddress: "Calle Mayor 5, Madrid" ✓
      - items: "50m2 de césped premium" + "30km de desplazamiento" ✓
      - Tiene todo → procede

  5c. Llama calculateBudget({
        clientName: "Juan García",
        clientAddress: "Calle Mayor 5, Madrid",
        items: [
          { nameOrCode: "Cesped premium", quantity: 50 },
          { nameOrCode: "Desplazamiento", quantity: 30 }
        ],
        applyVat: true
      })

PASO 6 — calculateBudget Tool
  6a. Busca org → obtiene datos de empresa (nombre, NIF, logo...)
  6b. Busca catálogo activo
  6c. Para "Cesped premium":
      → findItem("Cesped premium") → ILIKE match → { name: "Cesped premium", price: 16.00, unit: "m²" }
      → lineTotal = 16.00 × 50 = 800.00 €
  6d. Para "Desplazamiento":
      → findItem("Desplazamiento") → match exacto → { name: "Desplazamiento", price: 10.00, unit: "km" }
      → lineTotal = 10.00 × 30 = 300.00 €
  6e. subtotal = 1100.00, IVA 21% = 231.00, total = 1331.00
  6f. PdfService genera PDF con estos datos
  6g. PDF se guarda en:
      - pdfStore (in-memory, para WhatsApp)
      - attachmentStore (para Gmail)
      - tabla quotes (permanente)

PASO 7 — Respuesta al usuario (SSE)
  QuoteAgent devuelve texto como:
    "He generado el presupuesto PRES-20260309-1234 para Juan García:
     - Cesped premium: 50 m² × 16,00 € = 800,00 €
     - Desplazamiento: 30 km × 10,00 € = 300,00 €
     Subtotal: 1.100,00 €
     IVA (21%): 231,00 €
     Total: 1.331,00 €
     El PDF está listo para descargar."

  El stream emite: sources → text chunks → done

PASO 8 — Descarga del PDF (posterior)
  El usuario va a la página Quotes en el dashboard
  → GET /quotes → lista de presupuestos (sin pdfBase64, solo metadata)
  → Click "Download PDF" → GET /quotes/:id/pdf → { pdfBase64, filename }
  → Frontend: atob(base64) → Blob → download trigger
```

---

## 7. Flujo por WhatsApp

Cuando el presupuesto se genera via WhatsApp, el flujo cambia ligeramente:

```
WhatsApp msg → Worker → POST /internal/whatsapp/message → Coordinator → QuoteAgent
                                                                           │
                                                            (mismo flujo que chat)
                                                                           │
                                                                           ▼
                                                              PDF generado + guardado
                                                              en pdfStore (in-memory)
                                                                           │
                                                                           ▼
                                                            Respuesta texto al usuario
                                                            (sin PDF adjunto por WhatsApp,
                                                             el PDF se descarga del dashboard)
```

> **Limitación actual**: El PDF no se envía como archivo por WhatsApp. Solo se genera y se guarda. El usuario debe ir al dashboard para descargarlo, o pedir que se envíe por email (si el plugin Gmail está configurado).

---

## 8. Campo `description` — Rol exacto

### Qué es
El campo `description` de `catalog_items` es un texto libre que explica al LLM qué es ese producto. Ejemplos:
- "Césped sintético de fibra corta, ideal para jardines residenciales con poco tránsito"
- "Precio fijo por desplazamiento del equipo. Se cobra por km desde el almacén"

### Dónde lo ve el LLM
Solo en la respuesta de `listCatalog`:
```json
{
  "items": [
    {
      "code": 3,
      "name": "Cesped premium",
      "description": "Fibra larga 40mm, alta densidad, para zonas de mucho uso",
      "pricePerUnit": 16.00,
      "unit": "m²"
    }
  ]
}
```

### Dónde NO aparece
- **PDF**: La columna "Descripción" del PDF muestra `catalogItem.name`, NO `description`
- **Tabla quotes**: `line_items[].description` contiene solo el `name`
- **Dashboard (QuotesPage)**: muestra los datos de `quotes`, que solo tienen el `name`

### Por qué existe
Para que el LLM pueda:
1. Hacer matching inteligente ("quiero el césped bueno" → el de mayor precio/calidad)
2. Entender unidades ("el desplazamiento se cobra por km, no por m²")
3. Sugerir productos relevantes ("si necesita 200m², le recomiendo el premium ultimate")
