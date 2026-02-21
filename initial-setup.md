# initial-setup.md

## Cómo configurar este RAG agent

No rellenes este archivo manualmente.

Ejecuta el agente configurador en Claude Code:

```
/agent setup-agent
```

El agente te hará las preguntas necesarias de forma conversacional, sugerirá la configuración óptima para tu caso de uso, y aplicará los cambios directamente en el código cuando confirmes.

**Qué hace el agente:**
1. Detecta si ya hay una configuración previa (`setup-responses.md`) — si existe, muestra el estado actual y solo pregunta qué quieres cambiar
2. Hace ~10 preguntas una a la vez, con sugerencias razonadas basadas en tu contexto
3. Muestra un resumen antes de tocar ningún archivo
4. Genera o actualiza: `src/config/rag.config.ts`, `CLAUDE.md`, `.env.example`
5. Guarda las respuestas en `setup-responses.md` para sesiones futuras

**Primera vez:**
```
/agent setup-agent
→ El agente empieza desde cero
```

**Cambiar algo después:**
```
/agent setup-agent
→ El agente detecta la config existente y pregunta qué quieres modificar
```

---

## Referencia de parámetros

Si quieres entender qué configura cada parámetro antes de hablar con el agente, ver `RAG-REFERENCE.md`.
