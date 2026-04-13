import type { DelegationResult, AgentToolResult } from "./types.js";

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

type VerificationRule = (result: DelegationResult) => VerificationResult;

/**
 * Post-delegation verification rules.
 * Each rule checks the quality/completeness of a sub-agent's response.
 * These are LIGHTWEIGHT programmatic checks — not another LLM call.
 */
const verificationRules: Record<string, VerificationRule> = {
  quote: (result) => {
    // Verify that calculateBudget produced a filename
    const budgetResult = result.toolResults.find((t) => t.toolName === "calculateBudget");
    if (budgetResult) {
      const r = budgetResult.result as Record<string, unknown> | undefined;
      if (!r?.["filename"]) {
        return { valid: false, reason: "El presupuesto se generó pero no se creó el archivo PDF." };
      }
    }
    return { valid: true };
  },

  gmail: (result) => {
    // Verify that sendEmail returned a draftId or messageId
    const emailResult = result.toolResults.find((t) => t.toolName === "sendEmail");
    if (emailResult) {
      const r = emailResult.result as Record<string, unknown> | undefined;
      if (!r?.["draftId"] && !r?.["messageId"]) {
        return { valid: false, reason: "El email no se pudo crear como borrador. Revisa la conexión con Gmail." };
      }
    }
    return { valid: true };
  },

  calendar: (result) => {
    // Verify that createEvent returned an eventId
    const createResult = result.toolResults.find((t) => t.toolName === "createEvent");
    if (createResult) {
      const r = createResult.result as Record<string, unknown> | undefined;
      if (!r?.["eventId"] && !r?.["id"] && !r?.["htmlLink"]) {
        return { valid: false, reason: "El evento no se pudo confirmar en el calendario." };
      }
    }
    return { valid: true };
  },

  expenses: (result) => {
    const recordResult = result.toolResults.find((t) => t.toolName === "recordExpense");
    if (recordResult) {
      const r = recordResult.result as Record<string, unknown> | undefined;
      if (!r?.["expenseId"]) {
        return { valid: false, reason: "El gasto no se guardó correctamente." };
      }
      const amount = r?.["amount"] as number | undefined;
      if (amount != null && (amount <= 0 || amount > 50000)) {
        return { valid: false, reason: `Importe sospechoso (${amount}€). Verifica con el usuario.` };
      }
    }
    const driveResult = result.toolResults.find((t) => t.toolName === "uploadReceiptToDrive");
    if (driveResult) {
      const r = driveResult.result as Record<string, unknown> | undefined;
      if (r?.["success"] === true && !r?.["fileId"]) {
        return { valid: false, reason: "La subida a Drive reportó éxito pero no devolvió fileId." };
      }
    }
    return { valid: true };
  },

  rag: (result) => {
    // Verify minimum response length for non-trivial queries
    if (result.text && result.text.length < 10 && result.toolResults.length > 0) {
      return { valid: false, reason: "La respuesta del agente fue demasiado breve." };
    }
    return { valid: true };
  },
};

/**
 * Run verification rules for a specific plugin's delegation result.
 * Returns { valid: true } if all checks pass.
 */
export function verifyDelegationResult(pluginId: string, result: DelegationResult): VerificationResult {
  const rule = verificationRules[pluginId];
  if (!rule) return { valid: true };

  try {
    return rule(result);
  } catch {
    // Never let verification crash the delegation
    return { valid: true };
  }
}
