/**
 * Tests the ACTUAL extractReceiptData function with a real image.
 * This validates the complete flow: image → Gemini API → JSON parse → Zod validation.
 *
 * Usage: npx tsx scripts/test-full-extraction.mts <path-to-image>
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { extname } from "path";
import { extractReceiptData, validateExtraction, formatExtractionForAgent } from "../src/plugins/expenses/services/receipt-extractor.js";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: npx tsx scripts/test-full-extraction.mts <path-to-image>");
  process.exit(1);
}

const imageData = readFileSync(imagePath);
const ext = extname(imagePath).toLowerCase();
const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const mimeType = mimeMap[ext] ?? "image/jpeg";

console.log(`Image: ${imagePath} (${imageData.length} bytes, ${mimeType})`);
console.log("---");

const result = await extractReceiptData({ data: new Uint8Array(imageData), mimeType });

if (!result) {
  console.error("EXTRACTION FAILED — returned null");
  process.exit(1);
}

console.log("Extracted data:");
console.log(JSON.stringify(result, null, 2));

const issues = validateExtraction(result);
console.log("\nValidation issues:", issues.length ? issues : "NONE");

const formatted = formatExtractionForAgent(result, issues);
console.log("\nFormatted for agent:");
console.log(formatted);
