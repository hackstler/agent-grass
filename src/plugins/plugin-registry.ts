import type { Hono } from "hono";
import type { AgentTools } from "../agent/types.js";
import type { Plugin } from "./plugin.interface.js";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import { createDelegationTools } from "../agent/delegation.js";
import { logger } from "../shared/logger.js";

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
    logger.info({ pluginId: plugin.id, pluginName: plugin.name }, "Plugin registered");
  }

  get(id: string): Plugin {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin "${id}" not found`);
    }
    return plugin;
  }

  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getAllTools(): AgentTools {
    const tools: AgentTools = {};
    for (const plugin of this.plugins.values()) {
      Object.assign(tools, plugin.tools);
    }
    return tools;
  }

  getDelegationTools(convManager: ConversationManager): AgentTools {
    return createDelegationTools(this.getAll(), convManager);
  }

  mountRoutes(app: Hono): void {
    for (const plugin of this.plugins.values()) {
      if (plugin.routes) {
        const router = plugin.routes();
        // Routes are mounted by the caller at the appropriate paths
        // The plugin's routes() returns a Hono instance with its own paths
        app.route("/", router);
        logger.info({ pluginId: plugin.id }, "Plugin routes mounted");
      }
    }
  }

  async ensureTablesForAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.ensureTables) {
        await plugin.ensureTables();
        logger.info({ pluginId: plugin.id }, "Plugin tables ready");
      }
    }
  }

  async initializeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.initialize) {
        await plugin.initialize();
        logger.info({ pluginId: plugin.id }, "Plugin initialized");
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.shutdown) {
        await plugin.shutdown();
        logger.info({ pluginId: plugin.id }, "Plugin shut down");
      }
    }
  }
}
