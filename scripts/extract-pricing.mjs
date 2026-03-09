/**
 * One-off script to extract grass pricing data from the Excel file.
 * Generates a JSON file with 10,400 entries (8 grass types × 650 m² × 2 surfaces).
 *
 * Usage: node scripts/extract-pricing.mjs
 * Output: src/infrastructure/db/grass-pricing-data.json
 */
import XLSX from "xlsx";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXCEL_PATH = resolve(process.env.HOME, "Downloads/Horas Tarifas Completo.xlsx");
const OUTPUT_PATH = resolve(__dirname, "../src/infrastructure/db/grass-pricing-data.json");

// Grass types and their S+I price columns (0-indexed)
const GRASS_TYPES = [
  { name: "TESSA25", code: 1, col: 33, sortOrder: 1, description: "Césped artificial 25mm - Gama económica" },
  { name: "MAR30",   code: 2, col: 36, sortOrder: 2, description: "Césped artificial 30mm - Gama estándar" },
  { name: "LOREN34", code: 3, col: 39, sortOrder: 3, description: "Césped artificial 34mm - Gama media" },
  { name: "TIGA37",  code: 4, col: 43, sortOrder: 4, description: "Césped artificial 37mm - Gama media-alta" },
  { name: "LOTA40",  code: 5, col: 46, sortOrder: 5, description: "Césped artificial 40mm - Gama alta" },
  { name: "DAM40",   code: 6, col: 49, sortOrder: 6, description: "Césped artificial 40mm Premium - Gama alta" },
  { name: "LUNA42",  code: 7, col: 52, sortOrder: 7, description: "Césped artificial 42mm - Gama premium" },
  { name: "NAT45",   code: 8, col: 55, sortOrder: 8, description: "Césped artificial 45mm - Gama top" },
];

// Excel layout:
// Sheet "BBDD"
// Layout verified by debug:
// Row 6 (index 5): Header row
// Row 7 (index 6): First SOLADO data row (m²=1)
// SOLADO: index 6 to 655 (m²=1-650)
// TIERRA: index 656 to 1305 (m²=1-650)

const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets["BBDD"];
if (!sheet) {
  console.error("Sheet 'BBDD' not found. Available sheets:", wb.SheetNames);
  process.exit(1);
}

const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
console.log(`Total rows in BBDD: ${data.length}`);

const result = {
  grassTypes: GRASS_TYPES.map(({ name, code, description, sortOrder }) => ({
    name,
    code,
    description,
    sortOrder,
  })),
  pricing: [],
};

const SOLADO_START = 6;   // index of first SOLADO row (m²=1)
const TIERRA_START = 656; // index of first TIERRA row (m²=1)

// SOLADO: index 6 to 655
for (let m2 = 1; m2 <= 650; m2++) {
  const rowIdx = SOLADO_START + (m2 - 1);
  const row = data[rowIdx];
  if (!row) {
    console.warn(`Missing SOLADO row for m²=${m2} (rowIdx=${rowIdx})`);
    continue;
  }
  for (const grass of GRASS_TYPES) {
    const price = Number(row[grass.col]);
    if (isNaN(price) || price <= 0) {
      console.warn(`Invalid price for SOLADO/${grass.name}/m²=${m2}: ${row[grass.col]}`);
      continue;
    }
    result.pricing.push({
      grassName: grass.name,
      surfaceType: "SOLADO",
      m2,
      pricePerM2: Math.round(price * 100) / 100,
    });
  }
}

// TIERRA: index 656 to 1305
for (let m2 = 1; m2 <= 650; m2++) {
  const rowIdx = TIERRA_START + (m2 - 1);
  const row = data[rowIdx];
  if (!row) {
    console.warn(`Missing TIERRA row for m²=${m2} (rowIdx=${rowIdx})`);
    continue;
  }
  for (const grass of GRASS_TYPES) {
    const price = Number(row[grass.col]);
    if (isNaN(price) || price <= 0) {
      console.warn(`Invalid price for TIERRA/${grass.name}/m²=${m2}: ${row[grass.col]}`);
      continue;
    }
    result.pricing.push({
      grassName: grass.name,
      surfaceType: "TIERRA",
      m2,
      pricePerM2: Math.round(price * 100) / 100,
    });
  }
}

console.log(`Extracted ${result.pricing.length} pricing entries`);
console.log(`Expected: ${8 * 650 * 2} = ${8 * 650 * 2}`);

// Verify sample: SOLADO/TESSA25/m²=10 should be 47.85
const sample = result.pricing.find(
  (p) => p.surfaceType === "SOLADO" && p.grassName === "TESSA25" && p.m2 === 10
);
console.log(`Verification — SOLADO/TESSA25/m²=10: ${sample?.pricePerM2} (expected: 47.85)`);

writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
console.log(`Written to ${OUTPUT_PATH}`);
