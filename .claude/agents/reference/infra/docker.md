# Docker Reference

## This Project's Dockerfile

```dockerfile
# Stage 1: Base
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Stage 2: Production deps only
FROM base AS deps
RUN npm ci --omit=dev

# Stage 3: Build (needs dev deps for tsc/esbuild)
FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 4: Runtime (minimal)
FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations
COPY drizzle.config.ts ./
CMD ["node", "dist/index.js"]
```

## Key Decisions

**Why copy migrations separately**: esbuild bundles TypeScript into a single `dist/index.js`. It does NOT bundle `.sql` files. Migrations must be copied as-is from `src/db/migrations/` to `dist/db/migrations/`.

**Why `CMD ["node", "dist/index.js"]`**: No shell wrapping, no npm. This means npm lifecycle hooks (`prestart`) DON'T run. Migrations must be called programmatically from `main()`.

**Why `node:20-slim`**: Smaller than full node, but has glibc (needed for native modules). Alpine would be even smaller but breaks some npm packages.

## Layer Caching Strategy

```
COPY package.json → rarely changes → cached
npm ci → only runs when package.json changes → cached
COPY src → changes frequently → not cached
npm run build → runs every time src changes
```

This means most builds only re-run the last 2 steps, saving 30-60s.

## Worker Dockerfile (Puppeteer)

The WhatsApp worker needs Chromium:
```dockerfile
FROM node:20-slim AS base
# Install Chromium deps
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

Cannot use Alpine for the worker — Chromium needs glibc.

## Docker Compose (Local Dev)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: rag_backbone
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Use `pgvector/pgvector:pg16` — standard postgres doesn't include the vector extension.

## Security

- Run as non-root: `USER node` (node:20-slim includes a `node` user)
- No secrets in build args (they're visible in image history)
- Use multi-stage to exclude dev deps and source from runtime image
- `.dockerignore` to exclude `.env`, `.wwebjs_auth/`, `node_modules/`

## Debugging

```bash
# Build and run locally
docker build -t rag-backbone .
docker run -p 3000:3000 --env-file .env rag-backbone

# Shell into running container
docker exec -it <container> sh

# View logs
docker logs -f <container>

# Build with no cache (when layer caching causes issues)
docker build --no-cache -t rag-backbone .
```

## Common Issues

- **Missing native modules**: Some npm packages need `python3` and `build-essential` during build. Add to build stage, not runtime.
- **Large image size**: Check with `docker images`. Runtime should be <300MB. If larger, check node_modules for unnecessary packages.
- **File permission errors**: If copying files as root, change ownership: `COPY --chown=node:node`
