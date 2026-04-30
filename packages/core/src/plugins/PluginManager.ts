import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPlugin } from "./Plugin.js";

import { PluginError } from "@/errors/PluginError.js";

export class PluginManager {
    private plugins: Map<string, VimcordPlugin> = new Map();

    constructor(readonly client: Vimcord) {}

    async load(): Promise<void> {
        for (const plugin of this.plugins.values()) {
            if (plugin.installed) continue;
            await plugin.install(this.client);
        }
    }

    async unload(name?: string): Promise<void> {
        if (name) {
            const plugin = this.plugins.get(name);
            if (!plugin) return;
            await plugin.uninstall?.(this.client);
            this.plugins.delete(plugin.name);
            return;
        }

        for (const plugin of this.plugins.values()) {
            await plugin.uninstall?.(this.client);
            this.plugins.delete(plugin.name);
        }
    }

    use(plugin: VimcordPlugin): void {
        if (this.plugins.has(plugin.name)) throw new PluginError(`Plugin '${plugin.name}' is already registered`);

        // Check deps
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this.plugins.has(dep)) {
                    throw new PluginError(`Plugin '${plugin.name}' depends on '${dep}', but it is not registered`);
                }
            }
        }

        this.plugins.set(plugin.name, plugin);
    }

    get(name: string): VimcordPlugin | undefined {
        return this.plugins.get(name);
    }

    getAll(installed?: boolean): VimcordPlugin[] {
        return Array.from(this.plugins.values()).filter(p => (installed ? p.installed : true));
    }

    has(name: string): boolean {
        return this.plugins.has(name);
    }
}
