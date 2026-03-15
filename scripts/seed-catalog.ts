import "dotenv/config";
import { db } from "../src/infrastructure/db/client.js";
import { users } from "../src/infrastructure/db/schema.js";
import { seedCatalog } from "../src/infrastructure/db/catalog-seed.js";

async function main() {
  // Find all distinct orgIds
  const rows = await db
    .select({ orgId: users.orgId })
    .from(users)
    .groupBy(users.orgId);

  if (rows.length === 0) {
    console.log("No users found. Create a user first.");
    process.exit(1);
  }

  for (const row of rows) {
    console.log(`Seeding catalog for org: ${row.orgId}`);
    await seedCatalog(row.orgId);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
