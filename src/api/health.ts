import { Hono } from "hono";
import { execSync } from "child_process";
import { checkDbConnection } from "../infrastructure/db/client.js";

let gitCommit = "unknown";
try { gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a git repo in production */ }

const health = new Hono();

health.get("/", async (c) => {
  const dbOk = await checkDbConnection();

  const status = dbOk ? "ok" : "degraded";
  const httpStatus = dbOk ? 200 : 503;

  return c.json(
    {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? "ok" : "error",
      },
      version: "0.1.0",
      commit: gitCommit,
    },
    httpStatus
  );
});

export default health;
