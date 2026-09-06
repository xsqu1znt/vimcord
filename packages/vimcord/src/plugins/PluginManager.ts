import type { HealthProbe, RegisteredHealthProbe } from "@/cli/types.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPlugin, VimcordPluginContext } from "./Plugin.js";

import { PluginError } from "@/errors/PluginError.js";

export class PluginManager {
    private plugins: Map<string, VimcordPlugin> = new Map();
    /** Manager-owned installation state. Plugins never expose or mutate this themselves. */
    private readonly installedNames = new Set<string>();
    private readonly healthProbes = new Map<string, Map<string, HealthProbe>>();

    constructor(private client: Vimcord) {}

    async load(): Promise<void> {
        let installedCount = 0;
        for (const plugin of this.resolveLoadOrder()) {
            if (this.installedNames.has(plugin.name)) continue;

            const context = this.createPluginContext(plugin.name);
            try {
                await plugin.install(context);
                this.installedNames.add(plugin.name);
                installedCount++;
            } catch (error) {
                // A failed install may already own resources, so give the plugin its normal cleanup opportunity.
                try {
                    await plugin.uninstall?.();
                } catch (cleanupError) {
                    this.client.logger.plugin.error(
                        plugin.name,
                        "Failed to clean up after installation error",
                        cleanupError
                    );
                } finally {
                    this.installedNames.delete(plugin.name);
                    this.healthProbes.delete(plugin.name);
                }
                throw error;
            }
        }

        if (installedCount) {
            this.client.logger.debug(`[PluginManager] Loaded ${installedCount} plugin${installedCount === 1 ? "" : "s"}`);
        }
    }

    /** Uninstalls every installed plugin in reverse dependency order and clears the registry. */
    async unload(): Promise<void> {
        const errors: unknown[] = [];
        for (const plugin of this.resolveLoadOrder().reverse()) {
            if (this.installedNames.has(plugin.name)) {
                try {
                    await plugin.uninstall?.();
                } catch (error) {
                    errors.push(error);
                } finally {
                    this.installedNames.delete(plugin.name);
                    this.healthProbes.delete(plugin.name);
                }
            }
            this.plugins.delete(plugin.name);
        }

        if (errors.length) throw new AggregateError(errors, "Failed to unload one or more plugins");
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
        const plugin = this.plugins.get(name) as T | undefined;
        if (installed && !this.isInstalled(name)) {
            throw new PluginError(`Plugin '${name}' is not installed on '${this.client.$name}'`);
        }

        return plugin;
    }

    getAll(installed?: boolean): VimcordPlugin[] {
        return Array.from(this.plugins.values()).filter(p =>
            installed === undefined ? true : this.isInstalled(p.name) === installed
        );
    }

    has(name: string): boolean {
        return this.plugins.has(name);
    }

    /** Whether the named plugin has completed installation on this client. */
    isInstalled(name: string): boolean {
        return this.installedNames.has(name);
    }

    /** Returns installed plugin health probes with their owners. */
    getHealthProbes(): RegisteredHealthProbe[] {
        return this.getAll(true).flatMap(plugin =>
            Array.from(this.healthProbes.get(plugin.name)?.values() ?? []).map(probe => ({
                pluginName: plugin.name,
                probe
            }))
        );
    }

    private createPluginContext(pluginName: string): VimcordPluginContext {
        const probes = this.getPluginHealthProbes(pluginName);

        return {
            client: this.client,
            health: {
                register: probe => {
                    if (!probe.id.trim())
                        throw new PluginError(`Plugin '${pluginName}' registered a health probe without an id`);
                    if (probes.has(probe.id)) {
                        throw new PluginError(`Plugin '${pluginName}' already registered health probe '${probe.id}'`);
                    }

                    // Probe ids are client-wide so combined `/ping` output is stable and unambiguous.
                    const owner = Array.from(this.healthProbes.entries()).find(
                        ([ownerName, values]) => ownerName !== pluginName && values.has(probe.id)
                    );
                    if (owner) {
                        throw new PluginError(
                            `Plugin '${pluginName}' cannot register health probe '${probe.id}'; it is already provided by '${owner[0]}'`
                        );
                    }

                    probes.set(probe.id, probe);
                }
            }
        };
    }

    private getPluginHealthProbes(pluginName: string): Map<string, HealthProbe> {
        const existing = this.healthProbes.get(pluginName);
        if (existing) return existing;

        const probes = new Map<string, HealthProbe>();
        this.healthProbes.set(pluginName, probes);
        return probes;
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
