import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPlugin } from "./Plugin.js";

import { PluginError } from "@/errors/PluginError.js";

export class PluginManager {
    private plugins: Map<string, VimcordPlugin> = new Map();

    constructor(private client: Vimcord) {}

    async load(): Promise<void> {
        let installedCount = 0;
        for (const plugin of this.resolveLoadOrder()) {
            if (plugin.installed) continue;
            await plugin.install(this.client);
            plugin.installed = true;
            installedCount++;
        }

        if (installedCount) {
            this.client.logger.debug(`[PluginManager] Loaded ${installedCount} plugin${installedCount === 1 ? "" : "s"}`);
        }
    }

    async unload(name?: string): Promise<void> {
        if (name) {
            const plugin = this.plugins.get(name);
            if (!plugin) return;
            const dependent = this.getAll(true).find(p => p.dependencies?.includes(name));
            if (dependent) {
                throw new PluginError(`Plugin '${name}' cannot be unloaded while '${dependent.name}' depends on it`);
            }

            if (plugin.installed) {
                await plugin.uninstall(this.client);
                plugin.installed = false;
            }
            this.plugins.delete(plugin.name);
            return;
        }

        for (const plugin of this.resolveLoadOrder().reverse()) {
            if (plugin.installed) {
                await plugin.uninstall(this.client);
                plugin.installed = false;
            }
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

    get<T extends VimcordPlugin>(name: string): T | undefined;
    get<T extends VimcordPlugin>(name: string, installed: true): T;
    get<T extends VimcordPlugin>(name: string, installed?: boolean): T | undefined;
    get<T extends VimcordPlugin>(name: string, installed?: boolean): T | undefined {
        const plugin = this.plugins.get(name) as T;
        if (installed && !plugin.installed) {
            throw new PluginError(`Plugin '${name}' is not installed on client (${this.client.id})`);
        }

        return plugin;
    }

    getAll<T extends VimcordPlugin[]>(installed: true): T;
    getAll<T extends (VimcordPlugin | undefined)[]>(installed?: boolean): T;
    getAll<T extends VimcordPlugin[]>(installed?: boolean): T {
        return Array.from(this.plugins.values()).filter(p =>
            installed === undefined ? true : p.installed === installed
        ) as T;
    }

    has(name: string): boolean {
        return this.plugins.has(name);
    }

    private resolveLoadOrder(): VimcordPlugin[] {
        const resolved: VimcordPlugin[] = [];
        const resolving = new Set<string>();
        const resolvedNames = new Set<string>();

        const visit = (plugin: VimcordPlugin): void => {
            if (resolvedNames.has(plugin.name)) return;
            if (resolving.has(plugin.name)) {
                throw new PluginError(`Circular plugin dependency detected at '${plugin.name}'`);
            }

            resolving.add(plugin.name);

            for (const dep of plugin.dependencies ?? []) {
                const dependency = this.plugins.get(dep);
                if (!dependency) {
                    throw new PluginError(`Plugin '${plugin.name}' depends on '${dep}', but it is not registered`);
                }
                visit(dependency);
            }

            resolving.delete(plugin.name);
            resolvedNames.add(plugin.name);
            resolved.push(plugin);
        };

        for (const plugin of this.plugins.values()) {
            visit(plugin);
        }

        return resolved;
    }
}
