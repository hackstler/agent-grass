# Frontend Rules

## React

- Componentes funcionales siempre. No class components.
- Props con `interface` tipada: `interface ChatPanelProps { ... }`
- Custom hooks en `src/hooks/` — nombrar `useXxx`
- Estado local con `useState` / `useReducer`
- `useEffect` siempre con cleanup:
  ```typescript
  useEffect(() => {
    const controller = new AbortController()
    fetchData({ signal: controller.signal })
    return () => controller.abort()
  }, [deps])
  ```
- Composición sobre herencia: usar `children`, render props, HOCs

## Tailwind CSS v4

- Entry point: `@import "tailwindcss"` en `index.css`
- Design tokens en `@theme {}` (colores, fonts)
- **Utility-first**: usar clases de Tailwind directamente en JSX
- **No** `@apply` — componer utilities en className
- **No** crear CSS custom classes para componentes nuevos
- Responsive mobile-first: `sm:`, `md:`, `lg:`
- Dark mode con `dark:` variant (si se necesita)
- Componentes existentes con CSS plano (`classNames`) se mantienen — no migrar

## SOLID en React

- **SRP**: un componente = una responsabilidad (WhatsAppPanel no hace fetch + render + state management)
- **OCP**: extender via `children` / composición, no con flags booleanos (`isAdmin`, `showExtra`)
- **LSP**: componentes con misma Props interface son intercambiables
- **ISP**: props pequeñas y enfocadas — no pasar objetos enteros cuando solo se usa un campo
- **DIP**: componentes dependen de hooks/context, no de implementaciones concretas de API

## API Client

- Centralizar en `src/api/` — un archivo por dominio (`channels.ts`, `chat.ts`)
- **No** usar `EventSource` para SSE — usar `ReadableStream` del `fetch` response
- Polling: pausar cuando la pestaña pierde foco (`document.hidden`)
- Error handling tipado:
  ```typescript
  type ApiResult<T> = { data: T } | { error: string }
  ```
- Base URL desde `import.meta.env["VITE_API_URL"]`
- Auth header: `Authorization: Bearer ${token}`

## TypeScript

- `strict: true` siempre
- `interface` para shapes de objetos, `type` para unions y aliases
- **Nunca** `any` — usar `unknown` con type guards o generics
- Discriminated unions para eventos:
  ```typescript
  type ChannelEvent =
    | { type: "qr"; qrData: string }
    | { type: "connected"; phone: string }
    | { type: "disconnected" }
  ```
- Exportar tipos compartidos desde `src/types.ts`
