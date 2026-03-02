import { Hono } from "hono";
import { checkDbConnection } from "../infrastructure/db/client.js";

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
    },
    httpStatus
  );
});

export default health;
