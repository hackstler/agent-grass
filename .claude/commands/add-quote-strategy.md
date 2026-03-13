# /add-quote-strategy

Añade un nuevo tipo de negocio al sistema de presupuestos usando el Strategy Pattern.

## Uso

```
/add-quote-strategy                           # modo interactivo — wizard
/add-quote-strategy <business-type> "<desc>"  # modo directo
```

Ejemplos:
```
/add-quote-strategy
/add-quote-strategy cleaning "Presupuestos para servicios de limpieza profesional"
/add-quote-strategy plumbing "Presupuestos para instalaciones de fontanería"
```

---

## Contexto — Cómo funciona el Quote Strategy Pattern

El sistema de presupuestos usa el **Strategy Pattern** para desacoplar la lógica de negocio del orquestador.

```
                    QuoteStrategyRegistry
                           │
                    resolve(businessType)
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       GrassStrategy  CleaningStr.  PlumbingStr.
       (césped)       (limpieza)   (fontanería)
```

Cada strategy define:
- **Qué datos pedir** al vendedor (input schema)
- **Cómo calcular** el presupuesto (fórmula)
- **Cómo generar el PDF** (layout)
- **Qué instrucciones** darle al agente LLM (system prompt)

El catálogo tiene un campo `businessType` que conecta automáticamente org → catálogo → strategy.

**Archivos clave del patrón:**
- `src/plugins/quote/strategies/quote-strategy.interface.ts` — contrato
- `src/plugins/quote/strategies/grass.strategy.ts` — implementación de referencia (césped)
- `src/plugins/quote/strategies/index.ts` — registry
- `src/plugins/quote/tools/calculate-budget.tool.ts` — orquestador (consume la strategy)
- `src/plugins/quote/quote.agent.ts` — agente (consume instructions de la strategy)

---

## Instrucciones para Claude

### Paso 1 — Recopilar información

**Si se invocó sin argumentos:**

Pregunta al usuario:

> "¿Qué tipo de negocio necesitas?
>
> Necesito saber:
> 1. **Nombre del negocio** (ej: `cleaning`, `plumbing`, `solar`) — será el `businessType`
> 2. **¿Qué se presupuesta?** (ej: "horas de limpieza por tipo de servicio", "metros de tubería + materiales")
> 3. **¿Qué datos necesita el vendedor dar?** (ej: m², horas, número de habitaciones, tipo de servicio)
> 4. **¿Qué productos/servicios tiene el catálogo?** (ej: "3 niveles de limpieza: básica, profunda, industrial")
> 5. **¿Cómo se calcula el precio?** (ej: "precio/hora × horas + desplazamiento", "precio/m² × m² + materiales")
> 6. **¿Qué columnas tiene el PDF comparativo?** (ej: "Servicio | Precio/hora | Horas | Desplazamiento | Total")"

**Si se invocó con argumentos:**
Infiere lo que puedas de la descripción y pregunta lo que falte.

### Paso 2 — Leer archivos de referencia (en paralelo)

- `src/plugins/quote/strategies/quote-strategy.interface.ts` — el contrato a implementar
- `src/plugins/quote/strategies/grass.strategy.ts` — implementación de referencia completa
- `src/plugins/quote/strategies/index.ts` — registry donde registrar
- `src/plugins/quote/services/pdf.service.ts` — PdfService disponible (puedes añadir métodos)
- `src/plugins/quote/services/catalog.service.ts` — CatalogService (getAllItems, findItem)

### Paso 3 — Derivar nombres

Del `<business-type>` en kebab-case:
- Filename: `<business-type>.strategy.ts`
- Class: `<PascalCase>QuoteStrategy` (ej: `CleaningQuoteStrategy`)
- businessType: `"<business-type>"` (ej: `"cleaning"`)
- displayName: nombre legible en español (ej: `"Limpieza Profesional"`)

### Paso 4 — Crear `src/plugins/quote/strategies/<business-type>.strategy.ts`

Implementar `QuoteStrategy` interface con estos métodos:

```typescript
import { z } from "zod";
import type {
  QuoteStrategy,
  QuoteCalculationResult,
  QuoteComparisonRow,
} from "./quote-strategy.interface.js";
import type { CompanyDetails } from "../services/pdf.service.js";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService } from "../services/pdf.service.js";

export class <PascalCase>QuoteStrategy implements QuoteStrategy {
  readonly businessType = "<business-type>";
  readonly displayName = "<Nombre Legible>";

  getInputSchema() {
    // Zod schema con los campos que el vendedor debe dar
    return z.object({
      clientName: z.string().min(3).describe("..."),
      clientAddress: z.string().min(10).describe("..."),
      province: z.string().optional().describe("..."),
      // ... campos específicos del negocio
      applyVat: z.boolean().default(true),
    });
  }

  getToolDescription(): string {
    // Descripción que ve el LLM para decidir cuándo llamar la tool
    return `...`;
  }

  getAgentInstructions(lang: string): string {
    // System prompt completo para el QuoteAgent cuando este negocio está activo
    // Seguir el patrón de grass.strategy.ts: REGLA ABSOLUTA + CONTEXTO + DATOS + FLUJO + RESULTADO
    return `...

Responde SIEMPRE en ${lang}.`;
  }

  getListCatalogDescription(): string {
    return `List the available items in the organization's catalog for <business-type>.`;
  }

  getListCatalogNote(): string {
    return "Usa calculateBudget para precios exactos.";
  }

  async calculate(params: {
    input: Record<string, unknown>;
    company: CompanyDetails;
    catalogId: string;
    catalogService: CatalogService;
  }): Promise<QuoteCalculationResult> {
    // 1. Extraer campos del input
    // 2. Obtener items del catálogo (catalogService.getAllItems o custom)
    // 3. Calcular rows con fórmula del negocio
    // 4. Devolver QuoteCalculationResult
  }

  async generatePdf(params: {
    quoteNumber: string;
    date: string;
    company: CompanyDetails;
    clientName: string;
    clientAddress: string;
    province: string;
    result: QuoteCalculationResult;
    pdfService: PdfService;
  }): Promise<string> {
    // Opción A: Añadir un nuevo método a PdfService y delegar
    // Opción B: Generar el PDF directamente aquí con pdf-lib
    // Devolver base64 string
  }
}
```

**Reglas del calculate():**
- Siempre devolver `QuoteComparisonRow[]` con `itemName`, `breakdown`, `subtotal`, `vat`, `total`
- El `breakdown` es un Record libre — mete las columnas que necesites (el PDF las lee)
- `quoteData` es lo que se persiste en JSONB — incluye todo lo necesario para regenerar el presupuesto
- `representativeTotals` usa la primera row (la más barata) para backward compat
- `extraColumns` son campos extra para la tabla `quotes` (surfaceType, areaM2, etc.)

**Reglas del generatePdf():**
- Puede delegar a PdfService (añadiendo un nuevo método) o generar directamente
- Si añades método a PdfService, definir interfaces para los datos (como ComparisonPdfData)
- Siempre devolver base64 del PDF generado

### Paso 5 — Registrar en el registry

Editar `src/plugins/quote/strategies/index.ts`:

```typescript
import { <PascalCase>QuoteStrategy } from "./<business-type>.strategy.js";

// En el constructor de QuoteStrategyRegistry:
constructor() {
  const grass = new GrassQuoteStrategy();
  this.defaultStrategy = grass;
  this.strategies.set(grass.businessType, grass);

  // ← Añadir aquí:
  const <type> = new <PascalCase>QuoteStrategy();
  this.strategies.set(<type>.businessType, <type>);
}
```

### Paso 6 — Crear catálogo con el businessType

Para que una org use esta strategy, necesita un catálogo con `businessType = "<business-type>"`.

Opción A — Seed script:
```typescript
// En seed o migration data
await db.insert(catalogs).values({
  orgId: "org-xxx",
  name: "Catálogo <Negocio> 2025",
  businessType: "<business-type>",
  effectiveDate: new Date(),
  isActive: true,
});
```

Opción B — Desde el dashboard de admin (si existe CRUD de catálogos).

### Paso 7 — Si el negocio necesita pricing especial

Si el negocio necesita una tabla de precios como `grassPricing` (ej: precio × m² × tipo):

1. Añadir tabla en `schema.ts`
2. `npx drizzle-kit generate --name=add-<business-type>-pricing`
3. Añadir método en `CatalogService` (ej: `getCleaningPrices()`)

Si solo usa `catalogItems.pricePerUnit` directamente, no hace falta tabla extra.

### Paso 8 — Type check

```bash
npx tsc --noEmit
```

### Paso 9 — Verificar que grass no se rompe

```bash
npx vitest run
```

Todos los tests existentes DEBEN seguir pasando. La nueva strategy no afecta a las existentes.

### Paso 10 — Mostrar resumen

- Archivo nuevo creado y ruta
- Cambios en `strategies/index.ts`
- Si se añadió tabla: migración generada
- Si se añadió método a PdfService: qué método
- businessType a usar al crear catálogos

---

## Reglas

- **NUNCA modificar `grass.strategy.ts`** — la strategy de césped es intocable
- **NUNCA modificar `calculate-budget.tool.ts`** — el orquestador es genérico, no necesita cambios
- **NUNCA modificar `quote.agent.ts`** — ya es dinámico via strategy
- Cada strategy es **autocontenida**: sus campos, su fórmula, su PDF, su prompt
- El `businessType` del catálogo es lo que conecta todo — sin config manual
- `clientName`, `clientAddress`, `province`, `applyVat` son comunes a todas las strategies
- Seguir la misma estructura que `grass.strategy.ts` como referencia
