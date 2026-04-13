/**
 * Quick test: calls the Gemini API directly with an image to verify extraction works.
 *
 * Usage: npx tsx scripts/test-extraction.mts <path-to-image>
 *
 * Requires GOOGLE_API_KEY in .env
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { extname } from "path";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: npx tsx scripts/test-extraction.mts <path-to-image>");
  process.exit(1);
}

const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
if (!apiKey) {
  console.error("Missing GOOGLE_API_KEY in .env");
  process.exit(1);
}

const imageData = readFileSync(imagePath);
const base64 = imageData.toString("base64");
const ext = extname(imagePath).toLowerCase();
const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const mimeType = mimeMap[ext] ?? "image/jpeg";

console.log(`Image: ${imagePath}`);
console.log(`Size: ${imageData.length} bytes (${base64.length} base64 chars)`);
console.log(`MIME: ${mimeType}`);
console.log(`Model: ${process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash"}`);
console.log("---");

const model = process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const body = {
  contents: [{
    parts: [
      { inlineData: { mimeType, data: base64 } },
      { text: "Extrae los datos de este ticket/factura en JSON: vendor, amount, vatAmount, vatRate, date (YYYY-MM-DD), concept, confidence (high/medium/low). Solo datos legibles, null si no visible." },
    ],
  }],
  generationConfig: { responseMimeType: "application/json" },
};

console.log("Calling Gemini API...\n");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log(`Status: ${res.status}`);

if (!res.ok) {
  const errText = await res.text();
  console.error("ERROR:", errText);
  process.exit(1);
}

const response = await res.json() as Record<string, unknown>;
const text = (response as any)?.candidates?.[0]?.content?.parts?.[0]?.text;

if (text) {
  console.log("Raw response:");
  console.log(text);
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim());
    console.log("\nParsed JSON:");
    console.log(JSON.stringify(json, null, 2));
  } catch (e) {
    console.error("\nFailed to parse JSON:", e);
  }
} else {
  console.log("No text in response:");
  console.log(JSON.stringify(response, null, 2));
}
