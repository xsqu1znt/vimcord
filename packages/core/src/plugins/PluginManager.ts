import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPlugin } from "./Plugin.js";

import { PluginError } from "@/errors/PluginError.js";

export class PluginManager {
    private plugins: Map<string, VimcordPlugin> = new Map();

    async use(plugin: VimcordPlugin, client: Vimcord): Promise<void> {
        if (this.plugins.has(plugin.name)) throw new PluginError(`Plugin '${plugin.name}' is already registered`);

        // Check deps
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this.plugins.has(dep)) {
                    throw new PluginError(`Plugin '${plugin.name}' depends on '${dep}', but it is not registered`);
                }
            }
        }

        // Install
        await plugin.install(client);
        this.plugins.set(plugin.name, plugin);
    }

    async remove(name: string, client: Vimcord): Promise<void> {
        const plugin = this.plugins.get(name);
        if (!plugin) throw new PluginError(`Plugin '${name}' is not registered`);

        // Uninstall
        await plugin.uninstall?.(client);
        this.plugins.delete(name);
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
