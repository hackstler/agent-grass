/**
 * Parse a natural language period into { from, to } ISO date strings (YYYY-MM-DD).
 * The LLM passes period strings like "este mes", "Q1 2026", "abril", "últimos 30 días".
 */
export function periodToDates(period: string): { from: string; to: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  const p = period.trim().toLowerCase();

  // Quarter patterns: "Q1 2026", "q2", "primer trimestre", "este trimestre"
  const quarterMatch = p.match(/q([1-4])\s*(\d{4})?/) ??
    p.match(/(primer|segundo|tercer|cuarto)\s+trimestre\s*(\d{4})?/);
  if (quarterMatch) {
    let q: number;
    const raw = quarterMatch[1];
    if (raw === "primer" || raw === "1") q = 1;
    else if (raw === "segundo" || raw === "2") q = 2;
    else if (raw === "tercer" || raw === "3") q = 3;
    else q = 4;

    const y = quarterMatch[2] ? Number(quarterMatch[2]) : year;
    const startMonth = (q - 1) * 3;
    const from = isoDate(y, startMonth, 1);
    const to = isoDate(y, startMonth + 2, lastDay(y, startMonth + 2));
    return { from, to, label: `Q${q} ${y}` };
  }

  // "este trimestre"
  if (p.includes("este trimestre") || p.includes("trimestre actual")) {
    const q = Math.floor(month / 3);
    const startMonth = q * 3;
    const from = isoDate(year, startMonth, 1);
    const to = isoDate(year, startMonth + 2, lastDay(year, startMonth + 2));
    return { from, to, label: `Q${q + 1} ${year}` };
  }

  // "este mes" / "mes actual"
  if (p.includes("este mes") || p.includes("mes actual")) {
    const from = isoDate(year, month, 1);
    const to = isoDate(year, month, lastDay(year, month));
    return { from, to, label: monthName(year, month) };
  }

  // "últimos N días"
  const daysMatch = p.match(/últimos?\s+(\d+)\s+días?/);
  if (daysMatch) {
    const n = Number(daysMatch[1]);
    const to = isoDate(now.getFullYear(), now.getMonth(), now.getDate());
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - n + 1);
    const from = isoDate(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    return { from, to, label: `últimos ${n} días` };
  }

  // Month by name: "enero", "febrero", ... optionally with year
  const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  for (let m = 0; m < 12; m++) {
    const name = monthNames[m]!;
    if (p.includes(name)) {
      const yearMatch = p.match(/\b(20\d{2})\b/);
      const y = yearMatch ? Number(yearMatch[1]) : year;
      const from = isoDate(y, m, 1);
      const to = isoDate(y, m, lastDay(y, m));
      return { from, to, label: `${name} ${y}` };
    }
  }

  // Year: "2026", "este año"
  const yearOnly = p.match(/^(20\d{2})$/) ?? (p.includes("este año") ? [null, String(year)] : null);
  if (yearOnly) {
    const y = Number(yearOnly[1]);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
  }

  // Fallback: current month
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, lastDay(year, month));
  return { from, to, label: monthName(year, month) };
}

function isoDate(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function lastDay(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function monthName(year: number, month: number): string {
  const names = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${names[month]} ${year}`;
}
