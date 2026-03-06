import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { quoteConfig } from "../config/quote.config.js";

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface CompanyDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  logo: string | null;
  vatRate: number;
  currency: string;
}

export interface QuoteData {
  quoteNumber: string;
  date: string;
  company: CompanyDetails;
  clientName: string;
  clientAddress: string;
  lineItems: QuoteLineItem[];
  subtotal: number;
  vatAmount: number;
  total: number;
}

const C = {
  black:      rgb(0.10, 0.10, 0.10),
  darkGray:   rgb(0.30, 0.30, 0.30),
  midGray:    rgb(0.55, 0.55, 0.55),
  lightGray:  rgb(0.93, 0.93, 0.93),
  white:      rgb(1, 1, 1),
  green:      rgb(0.18, 0.54, 0.34),
} as const;

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const COL_W = PAGE_W - MARGIN * 2;

function fmt(n: number, currency: string): string {
  return n.toFixed(2).replace(".", ",") + " " + currency;
}

export class PdfService {
  async generateQuotePdf(data: QuoteData): Promise<string> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

    const { company } = data;
    const currency = company.currency;

    let y = PAGE_H - MARGIN;

    // ── Header bar ────────────────────────────────────────────────────────────

    const headerH = 80;
    let logoImage: Awaited<ReturnType<typeof doc.embedPng>> | null = null;

    if (company.logo) {
      try {
        const logoBytes = Buffer.from(company.logo, "base64");
        // Try PNG first, fall back to JPEG
        try {
          logoImage = await doc.embedPng(logoBytes);
        } catch {
          logoImage = await doc.embedJpg(logoBytes) as unknown as typeof logoImage;
        }
      } catch {
        // Invalid logo data — skip silently
      }
    }

    page.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: C.green });

    if (logoImage) {
      const logoDims = logoImage.scale(1);
      const maxLogoH = headerH - 20;
      const maxLogoW = 120;
      const scale = Math.min(maxLogoH / logoDims.height, maxLogoW / logoDims.width, 1);
      const logoW = logoDims.width * scale;
      const logoH = logoDims.height * scale;
      page.drawImage(logoImage, {
        x: PAGE_W - MARGIN - logoW,
        y: PAGE_H - headerH + (headerH - logoH) / 2,
        width: logoW,
        height: logoH,
      });
    }

    page.drawText("PRESUPUESTO", {
      x: MARGIN, y: PAGE_H - 52,
      font: bold, size: 22, color: C.white,
    });
    page.drawText(`Nº ${data.quoteNumber}`, {
      x: MARGIN, y: PAGE_H - 68,
      font: regular, size: 10, color: C.white,
    });

    // Date — position depends on logo presence
    const dateX = logoImage ? MARGIN + 180 : PAGE_W - MARGIN - 70;
    page.drawText(data.date, {
      x: dateX, y: PAGE_H - 56,
      font: regular, size: 10, color: C.white,
    });

    y = PAGE_H - 100;

    // ── Company block ─────────────────────────────────────────────────────────
    page.drawText(company.name, { x: MARGIN, y, font: bold, size: 11, color: C.black });
    y -= 15;
    page.drawText(company.address, { x: MARGIN, y, font: regular, size: 9, color: C.darkGray });
    y -= 13;
    page.drawText(`Tel: ${company.phone}  ·  ${company.email}`, {
      x: MARGIN, y, font: regular, size: 9, color: C.darkGray,
    });
    y -= 13;
    page.drawText(`NIF: ${company.nif}`, { x: MARGIN, y, font: regular, size: 9, color: C.darkGray });

    y -= 24;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: C.midGray });

    // ── Client block ──────────────────────────────────────────────────────────
    y -= 18;
    page.drawText("CLIENTE", { x: MARGIN, y, font: bold, size: 9, color: C.midGray });
    y -= 14;
    page.drawText(data.clientName, { x: MARGIN, y, font: bold, size: 11, color: C.black });
    y -= 14;
    page.drawText(data.clientAddress, { x: MARGIN, y, font: regular, size: 9, color: C.darkGray });

    y -= 28;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: C.midGray });

    // ── Table header ──────────────────────────────────────────────────────────
    y -= 18;
    const cols = { desc: MARGIN, qty: MARGIN + 230, unit: MARGIN + 290, price: MARGIN + 360, total: MARGIN + 430 };

    page.drawRectangle({ x: MARGIN, y: y - 4, width: COL_W, height: 18, color: C.lightGray });
    page.drawText("Descripción",    { x: cols.desc,  y, font: bold, size: 9, color: C.darkGray });
    page.drawText("Cant.",          { x: cols.qty,   y, font: bold, size: 9, color: C.darkGray });
    page.drawText("Unidad",         { x: cols.unit,  y, font: bold, size: 9, color: C.darkGray });
    page.drawText("Precio/ud",      { x: cols.price, y, font: bold, size: 9, color: C.darkGray });
    page.drawText("Total",          { x: cols.total, y, font: bold, size: 9, color: C.darkGray });

    y -= 18;

    // ── Table rows ─────────────────────────────────────────────────────────────
    for (let i = 0; i < data.lineItems.length; i++) {
      const item = data.lineItems[i]!;
      if (i % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: COL_W, height: 16, color: rgb(0.97, 0.97, 0.97) });
      }
      page.drawText(item.description,          { x: cols.desc,  y, font: regular, size: 9, color: C.black });
      page.drawText(String(item.quantity),      { x: cols.qty,   y, font: regular, size: 9, color: C.black });
      page.drawText(item.unit,                  { x: cols.unit,  y, font: regular, size: 9, color: C.black });
      page.drawText(fmt(item.unitPrice, currency),  { x: cols.price, y, font: regular, size: 9, color: C.black });
      page.drawText(fmt(item.lineTotal, currency),  { x: cols.total, y, font: bold,    size: 9, color: C.black });
      y -= 18;
    }

    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: C.midGray });

    // ── Totals ────────────────────────────────────────────────────────────────
    const totalX = PAGE_W - MARGIN - 160;
    const valueX = PAGE_W - MARGIN - 10;

    const drawTotalRow = (label: string, value: string, isBold = false) => {
      y -= 16;
      page.drawText(label, { x: totalX, y, font: isBold ? bold : regular, size: 10, color: C.darkGray });
      const vWidth = (isBold ? bold : regular).widthOfTextAtSize(value, 10);
      page.drawText(value, { x: valueX - vWidth, y, font: isBold ? bold : regular, size: 10, color: C.black });
    };

    drawTotalRow("Subtotal:", fmt(data.subtotal, currency));
    drawTotalRow(`IVA (${Math.round(company.vatRate * 100)}%):`, fmt(data.vatAmount, currency));

    y -= 4;
    page.drawRectangle({ x: totalX - 8, y: y - 6, width: 160 + 18, height: 22, color: C.green });
    y -= 2;
    const totalStr = fmt(data.total, currency);
    page.drawText("TOTAL:", { x: totalX, y, font: bold, size: 11, color: C.white });
    const totalValueW = bold.widthOfTextAtSize(totalStr, 11);
    page.drawText(totalStr, { x: valueX - totalValueW, y, font: bold, size: 11, color: C.white });

    // ── Footer ────────────────────────────────────────────────────────────────
    page.drawText("Este presupuesto tiene una validez de 30 días desde su fecha de emisión.", {
      x: MARGIN, y: MARGIN + 10,
      font: regular, size: 8, color: C.midGray,
    });

    const bytes = await doc.save();
    return Buffer.from(bytes).toString("base64");
  }
}
