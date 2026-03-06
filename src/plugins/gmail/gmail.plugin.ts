import type { Plugin } from "../plugin.interface.js";
import type { ToolsInput } from "@mastra/core/agent";
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
  readonly tools: ToolsInput;

  constructor(tokenProvider: OAuthTokenProvider, attachmentStore: AttachmentStore) {
    const service = new GmailApiService(tokenProvider);
    const listEmails = createListEmailsTool({ gmailService: service });
    const readEmail = createReadEmailTool({ gmailService: service });
    const sendEmail = createSendEmailTool({ gmailService: service, attachmentStore });
    const searchEmails = createSearchEmailsTool({ gmailService: service });

    this.tools = { listEmails, readEmail, sendEmail, searchEmails };
    this.agent = createGmailAgent(this.tools);
  }
}
