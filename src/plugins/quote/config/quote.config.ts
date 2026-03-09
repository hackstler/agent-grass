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

  traviesasPricePerLm: 20.20,  // €/metro lineal traviesas madera tratada
  quoteValidityDays: 60,
  paymentTerms: "La forma de pago será 50% a la aprobación del presupuesto y 50% a la finalización de la obra.",
  companyRegistration: "",
  maxM2Lookup: 650,             // m² máximo en grass_pricing

  agentName: "QuoteAgent",
} as const;
