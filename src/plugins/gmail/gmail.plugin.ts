import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { OAuthTokenProvider } from "../google-common/oauth-token-provider.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import { GmailApiService } from "./services/gmail-api.service.js";
import { createListEmailsTool } from "./tools/list-emails.tool.js";
import { createReadEmailTool } from "./tools/read-email.tool.js";
import { createSendEmailTool } from "./tools/send-email.tool.js";
import { createSearchEmailsTool } from "./tools/search-emails.tool.js";
import { createGmailAgent } from "./gmail.agent.js";

export class GmailPlugin implements Plugin {
  readonly id = "gmail";
  readonly name = "Gmail Plugin";
  readonly description = "List, read, search, and send emails via Gmail. Can attach previously generated documents (e.g., PDF quotes).";
  readonly agent;
  readonly tools: AgentTools;
  /** GmailApiService exposed for the email confirm endpoint (sends drafts outside of the agent). */
  readonly gmailService: GmailApiService;

  constructor(tokenProvider: OAuthTokenProvider, attachmentStore: AttachmentStore) {
    this.gmailService = new GmailApiService(tokenProvider);
    const listEmails = createListEmailsTool({ gmailService: this.gmailService });
    const readEmail = createReadEmailTool({ gmailService: this.gmailService });
    const sendEmail = createSendEmailTool({ attachmentStore });
    const searchEmails = createSearchEmailsTool({ gmailService: this.gmailService });

    this.tools = { listEmails, readEmail, sendEmail, searchEmails };
    this.agent = createGmailAgent(this.tools);
  }
}
