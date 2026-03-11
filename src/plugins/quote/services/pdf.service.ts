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
  web: string;
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

export interface ComparisonRow {
  grassName: string;
  pricePerM2: number;
  totalGrassInstalled: number;
  aridosTotal: number;
  traviesasTotal: number;
  baseImponible: number;
  iva: number;
  totalConIva: number;
}

export interface ComparisonPdfData {
  quoteNumber: string;
  date: string;
  company: CompanyDetails;
  clientName: string;
  clientAddress: string;
  province: string;
  areaM2: number;
  surfaceType: "SOLADO" | "TIERRA";
  perimeterLm: number;
  sacasAridos: number;
  rows: ComparisonRow[];
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
  const [int, dec] = n.toFixed(2).split(".");
  const withDots = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return withDots + "," + dec + " " + currency;
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
        // Strip data-URI prefix if present (e.g. "data:image/png;base64,...")
        const raw = company.logo.includes(",")
          ? company.logo.split(",")[1]!
          : company.logo;
        const logoBytes = Buffer.from(raw, "base64");
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

  /**
   * Generates a landscape A4 comparison PDF matching Madrid Césped style:
   * white background, logo top-left, contact top-right, label:value client data,
   * 7-column comparison table, legal texts at bottom.
   */
  async generateComparisonPdf(data: ComparisonPdfData): Promise<string> {
    const doc = await PDFDocument.create();
    const LW = 842;
    const LH = 595;
    const page = doc.addPage([LW, LH]);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    const { company } = data;
    const currency = company.currency;
    const M = 36;
    const tableW = LW - M * 2;

    let y = LH - M;

    // ── Logo (top-left, large) ────────────────────────────────────────────
    let logoImage: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
    if (company.logo) {
      try {
        const raw = company.logo.includes(",")
          ? company.logo.split(",")[1]!
          : company.logo;
        const logoBytes = Buffer.from(raw, "base64");
        try {
          logoImage = await doc.embedPng(logoBytes);
        } catch {
          logoImage = await doc.embedJpg(logoBytes) as unknown as typeof logoImage;
        }
      } catch {
        // skip
      }
    }

    let logoBottomY = y; // track where the logo ends
    if (logoImage) {
      const dims = logoImage.scale(1);
      const maxH = 70;
      const maxW = 180;
      const scale = Math.min(maxH / dims.height, maxW / dims.width, 1);
      const lw = dims.width * scale;
      const lh = dims.height * scale;
      page.drawImage(logoImage, {
        x: M,
        y: y - lh,
        width: lw,
        height: lh,
      });
      logoBottomY = y - lh;
    }

    // ── Contact info (top-right) ──────────────────────────────────────────
    const rightX = LW - M;
    const emailText = company.email.toUpperCase();
    const emailW = bold.widthOfTextAtSize(emailText, 10);
    page.drawText(emailText, {
      x: rightX - emailW, y,
      font: bold, size: 10, color: C.black,
    });
    y -= 14;
    const telText = `tel: ${company.phone}`;
    const telW = regular.widthOfTextAtSize(telText, 9);
    page.drawText(telText, {
      x: rightX - telW, y,
      font: regular, size: 9, color: C.darkGray,
    });
    y -= 13;
    const webW = regular.widthOfTextAtSize(company.web, 9);
    page.drawText(company.web, {
      x: rightX - webW, y,
      font: regular, size: 9, color: C.darkGray,
    });
    y -= 24;

    // Fix: ensure y is below the logo before drawing the title
    y = Math.min(y, logoBottomY - 8);

    // ── Title ─────────────────────────────────────────────────────────────
    page.drawText("PRESUPUESTO CÉSPED ARTIFICIAL", {
      x: M, y,
      font: bold, size: 16, color: C.black,
    });
    y -= 24;

    // ── Client details (label:value aligned) ──────────────────────────────
    const labelRightX = M + 80;
    const valueLeftX = M + 90;

    const fmtNum = (n: number) => {
      const [int, dec] = n.toFixed(2).split(".");
      const withDots = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return withDots + "," + dec;
    };

    const clientFields = [
      { label: "CLIENTE:", value: data.clientName },
      { label: "PROVINCIA:", value: data.province || "" },
      { label: "DIRECCIÓN:", value: data.clientAddress },
      { label: "FECHA:", value: data.date },
      { label: "M2:", value: fmtNum(data.areaM2) },
    ];

    for (const field of clientFields) {
      if (!field.value) continue;
      const lw = bold.widthOfTextAtSize(field.label, 9);
      page.drawText(field.label, {
        x: labelRightX - lw, y,
        font: bold, size: 9, color: C.darkGray,
      });
      page.drawText(field.value, {
        x: valueLeftX, y,
        font: regular, size: 9, color: C.black,
      });
      y -= 14;
    }

    y -= 6;

    // ── Section header (underlined, no background) ────────────────────────
    const sectionText = "Suministro + Instalación (Todo incluido)";
    page.drawText(sectionText, {
      x: M, y,
      font: bold, size: 10, color: C.black,
    });
    const sectionW = bold.widthOfTextAtSize(sectionText, 10);
    y -= 3;
    page.drawLine({
      start: { x: M, y },
      end: { x: M + sectionW, y },
      thickness: 1,
      color: C.black,
    });
    y -= 16;

    // ── Table ─────────────────────────────────────────────────────────────
    const cols = [
      { x: M,       w: 70  },  // grass name
      { x: M + 70,  w: 95  },  // Precio M2
      { x: M + 165, w: 100 },  // Total Césped
      { x: M + 265, w: 85  },  // Áridos
      { x: M + 350, w: 100 },  // Traviesas
      { x: M + 450, w: 100 },  // Base Imp.
      { x: M + 550, w: 90  },  // IVA
      { x: M + 640, w: 130 },  // TOTAL
    ];

    // Two-line header
    const headers1 = ["", "Precio M2", "Total Césped", "Áridos", "Traviesas", "Base", "IVA", "TOTAL"];
    const headers2 = ["", "Todo Incluido", "Instalado", "", "madera incl.", "Imponible", "(21%)", "IVA INCLUIDO"];

    page.drawRectangle({ x: M, y: y - 8, width: tableW, height: 26, color: C.lightGray });
    for (let c = 0; c < cols.length; c++) {
      if (headers1[c]) {
        page.drawText(headers1[c]!, {
          x: cols[c]!.x + 4, y: y + 4,
          font: bold, size: 7.5, color: C.darkGray,
        });
      }
      if (headers2[c]) {
        page.drawText(headers2[c]!, {
          x: cols[c]!.x + 4, y: y - 6,
          font: regular, size: 7, color: C.midGray,
        });
      }
    }
    y -= 28;

    // Data rows
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i]!;
      if (i % 2 === 0) {
        page.drawRectangle({ x: M, y: y - 4, width: tableW, height: 16, color: rgb(0.97, 0.97, 0.97) });
      }

      const values = [
        row.grassName,
        fmt(row.pricePerM2, currency),
        fmt(row.totalGrassInstalled, currency),
        fmt(row.aridosTotal, currency),
        fmt(row.traviesasTotal, currency),
        fmt(row.baseImponible, currency),
        fmt(row.iva, currency),
        fmt(row.totalConIva, currency),
      ];

      for (let c = 0; c < cols.length; c++) {
        const isFirst = c === 0;
        const isLast = c === cols.length - 1;
        page.drawText(values[c]!, {
          x: cols[c]!.x + 4, y,
          font: (isFirst || isLast) ? bold : regular,
          size: 8,
          color: C.black,
        });
      }
      y -= 16;
    }

    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: LW - M, y }, thickness: 0.5, color: C.midGray });

    // ── Notes (traviesas + áridos) ──────────────────────────────────────
    y -= 14;
    if (data.perimeterLm > 0) {
      const perimeterStr = data.perimeterLm.toFixed(1).replace(".", ",");
      page.drawText(`*Traviesa de madera instalada en todo el perímetro ${perimeterStr} ml`, {
        x: M, y,
        font: regular, size: 8, color: C.darkGray,
      });
      y -= 12;
    }
    if (data.sacasAridos > 0) {
      page.drawText(`*Contempladas ${data.sacasAridos} sacas de zahorra para preparación de la base`, {
        x: M, y,
        font: regular, size: 8, color: C.darkGray,
      });
      y -= 12;
    }

    // ── Legal texts (bottom, italic) ──────────────────────────────────────
    let legalY = M + 36;

    if (quoteConfig.companyRegistration) {
      page.drawText(quoteConfig.companyRegistration, {
        x: M, y: legalY,
        font: italic, size: 7, color: C.midGray,
      });
      legalY += 12;
    }

    page.drawText(`Este presupuesto tiene una validez de ${quoteConfig.quoteValidityDays} días.`, {
      x: M, y: legalY,
      font: italic, size: 7.5, color: C.darkGray,
    });
    legalY += 12;

    page.drawText(quoteConfig.paymentTerms, {
      x: M, y: legalY,
      font: italic, size: 7.5, color: C.darkGray,
    });

    const bytes = await doc.save();
    return Buffer.from(bytes).toString("base64");
  }
}
