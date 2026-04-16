const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
(async () => {
  const { rows } = await pool.query(`
    SELECT role, LEFT(content, 600) AS content,
           metadata->'toolCalls' AS tools,
           created_at
    FROM messages
    WHERE conversation_id = '1c9453f4-ffeb-4085-a363-94c5b067f2c3'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  for (const r of rows) {
    console.log("---");
    console.log(`[${r.created_at.toISOString()}] ${r.role}`);
    console.log("TOOLS:", JSON.stringify(r.tools));
    console.log("CONTENT:", r.content);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
