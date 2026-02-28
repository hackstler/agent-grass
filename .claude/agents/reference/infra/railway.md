# Railway Reference

## This Project's Services

| Project | Service | Type | URL |
|---------|---------|------|-----|
| caring-wisdom | rag-agent-backbone | Docker | `https://rag-agent-backbone-production.up.railway.app` |
| disciplined-intuition | whastapp-connect | Docker | (headless, no public HTTP) |
| courageous-education | agent-dashboard | Static (Caddy) | `https://agent-dashboard-production-f737.up.railway.app` |

## CLI Commands

```bash
# Authentication
railway login                              # interactive login
railway whoami                             # check auth

# Link to a service
railway link -p <project-id> -s <service> -e production

# Environment variables
railway variable list                      # show all vars
railway variable set KEY=VALUE             # set a var
railway variable delete KEY                # delete a var

# Run commands in prod environment
railway run -- <command>                   # wraps command with prod env vars
railway run -- node -e "console.log(process.env.DATABASE_URL)"
railway run -- npx drizzle-kit push

# Logs
railway logs --tail                        # real-time streaming
railway logs --latest                      # recent logs (last few minutes)

# Deploy
railway up                                 # deploy from local (no git push needed)
```

## Deploy Workflow

```
1. git push to linked branch
2. Railway detects push → starts build
3. Docker build (multi-stage)
4. Health check: GET /health
5. If 200 → deploy live, old container stops
6. If not 200 within timeout → rollback
```

## Environment Variables

### Backbone
| Variable | Value | Notes |
|----------|-------|-------|
| DATABASE_URL | (auto from Railway Postgres) | Connection string |
| JWT_SECRET | (shared with worker) | For JWT signing |
| GOOGLE_API_KEY | (Gemini API key) | Embeddings + LLM |
| ALLOWED_ORIGINS | dashboard URL | CORS whitelist |
| ADMIN_USERNAME | hackstler | Auto-seed admin |
| ADMIN_PASSWORD | admin1234 | Auto-seed password |
| GEMINI_MODEL | gemini-2.5-flash | LLM model |

### Worker
| Variable | Value | Notes |
|----------|-------|-------|
| BACKBONE_URL | backbone URL | Where to send messages |
| JWT_SECRET | (same as backbone) | For worker JWT |
| ORG_ID | hackstler | Org this worker serves |
| SESSION_PATH | .wwebjs_auth | WhatsApp session dir |

### Dashboard
| Variable | Value | Notes |
|----------|-------|-------|
| VITE_API_URL | backbone URL | **BUILD-TIME only** |
| PORT | 8080 | Caddy port |

**CRITICAL**: `VITE_*` vars are embedded at BUILD time. Changing them requires a redeploy, not just a restart.

## Static Sites (Dashboard)

- Railway detects Vite/React → uses Caddy to serve
- Caddy listens on PORT (default: varies, MUST set to 8080)
- SPA routing handled automatically by Caddy
- No server-side code — purely static files

## Troubleshooting

### 502 Bad Gateway
- Service crashed during startup
- Check: `railway logs --latest`
- Common cause: missing env var, DB not reachable, migration failed

### Deploy Stuck
- Build is taking too long or failed
- Check: Railway dashboard → Deployments → Build logs
- Common cause: `npm install` hanging, Docker build cache invalidated

### ENV Var Not Applying
- `VITE_*` vars need redeploy (build-time)
- Other vars: restart service or redeploy
- Check: `railway variable list` to verify value

### Service Can't Connect to DB
- Check DATABASE_URL is set correctly
- Verify DB is in same Railway project/region
- Test: `railway run -- node -e "const { Pool } = require('pg'); const p = new Pool({connectionString: process.env.DATABASE_URL}); p.query('SELECT 1').then(() => console.log('OK')).catch(console.error)"`

### Health Check Failing
- GET /health must return 200
- Check: DB connectivity in health endpoint
- If pgvector not installed: `CREATE EXTENSION IF NOT EXISTS vector`

## Costs

- Hobby plan: $5/month per service
- PostgreSQL: included in plan, 1GB storage
- Bandwidth: 100GB/month included
- Build minutes: 500/month included
- Sleep: services sleep after inactivity on hobby plan (upgrade to prevent)
