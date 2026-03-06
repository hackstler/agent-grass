/**
 * Default values used as fallback when an organization has no data configured.
 * In production, the org record in the database takes precedence.
 */
export const quoteConfig = {
  companyName:    process.env["QUOTE_COMPANY_NAME"]    ?? "Tu Empresa S.L.",
  companyAddress: process.env["QUOTE_COMPANY_ADDRESS"] ?? "Calle Ejemplo, 1 · 28001 Madrid",
  companyPhone:   process.env["QUOTE_COMPANY_PHONE"]   ?? "+34 600 000 000",
  companyNif:     process.env["QUOTE_COMPANY_NIF"]     ?? "B-00000000",
  companyEmail:   process.env["QUOTE_COMPANY_EMAIL"]   ?? "info@tuempresa.com",

  vatRate: 0.21,
  currency: "€",

  agentName: "QuoteAgent",
} as const;
