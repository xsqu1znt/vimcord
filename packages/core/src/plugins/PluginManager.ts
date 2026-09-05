import type { CLICommand, HealthProbe, RegisteredCLICommand, RegisteredHealthProbe } from "@/cli/types.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPlugin, VimcordPluginContext } from "./Plugin.js";

import { CORE_CLI_COMMAND_NAMES } from "@/cli/constants.js";
import { PluginError } from "@/errors/PluginError.js";

interface PluginContributions {
    commands: Map<string, CLICommand>;
    healthProbes: Map<string, HealthProbe>;
}

export class PluginManager {
    private plugins: Map<string, VimcordPlugin> = new Map();
    private readonly contributions = new Map<string, PluginContributions>();

    constructor(private client: Vimcord) {}

    async load(): Promise<void> {
        let installedCount = 0;
        for (const plugin of this.resolveLoadOrder()) {
            if (plugin.installed) continue;

            const context = this.createPluginContext(plugin.name);
            try {
                await plugin.install(context);
                plugin.installed = true;
                installedCount++;
            } catch (error) {
                // A failed install may already own resources, so give the plugin its normal cleanup opportunity.
                try {
                    await plugin.uninstall(context);
                } catch (cleanupError) {
                    this.client.logger.plugin.error(
                        plugin.name,
                        "Failed to clean up after installation error",
                        cleanupError
                    );
                } finally {
                    plugin.installed = false;
                    this.contributions.delete(plugin.name);
                }
                throw error;
            }
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
                try {
                    await plugin.uninstall(this.createPluginContext(plugin.name));
                } finally {
                    plugin.installed = false;
                    this.contributions.delete(plugin.name);
                }
            }
            this.plugins.delete(plugin.name);
            return;
        }

        const errors: unknown[] = [];
        for (const plugin of this.resolveLoadOrder().reverse()) {
            if (plugin.installed) {
                try {
                    await plugin.uninstall(this.createPluginContext(plugin.name));
                } catch (error) {
                    errors.push(error);
                } finally {
                    plugin.installed = false;
                    this.contributions.delete(plugin.name);
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
        if (installed && !plugin?.installed) {
            throw new PluginError(`Plugin '${name}' is not installed on '${this.client.$name}'`);
        }

        return plugin as T | undefined;
    }

    getAll<T extends VimcordPlugin[] = VimcordPlugin[]>(installed?: boolean): T {
        return Array.from(this.plugins.values()).filter(p =>
            installed === undefined ? true : p.installed === installed
        ) as T;
    }

    has(name: string): boolean {
        return this.plugins.has(name);
    }

    /** Returns installed plugin CLI commands with their owners. */
    getCLICommands(): RegisteredCLICommand[] {
        return this.getAll(true).flatMap(plugin =>
            Array.from(this.contributions.get(plugin.name)?.commands.values() ?? []).map(command => ({
                pluginName: plugin.name,
                command
            }))
        );
    }

    /** Returns installed plugin health probes with their owners. */
    getHealthProbes(): RegisteredHealthProbe[] {
        return this.getAll(true).flatMap(plugin =>
            Array.from(this.contributions.get(plugin.name)?.healthProbes.values() ?? []).map(probe => ({
                pluginName: plugin.name,
                probe
            }))
        );
    }

    private createPluginContext(pluginName: string): VimcordPluginContext {
        const contributions = this.getPluginContributions(pluginName);

        return {
            client: this.client,
            cli: {
                registerCommand: command => {
                    this.validateCLICommand(pluginName, command);
                    contributions.commands.set(command.name, command);

                    let registered = true;
                    return () => {
                        if (!registered) return;
                        registered = false;
                        if (contributions.commands.get(command.name) === command) {
                            contributions.commands.delete(command.name);
                        }
                    };
                }
            },
            health: {
                register: probe => {
                    if (!probe.id.trim())
                        throw new PluginError(`Plugin '${pluginName}' registered a health probe without an id`);
                    if (contributions.healthProbes.has(probe.id)) {
                        throw new PluginError(`Plugin '${pluginName}' already registered health probe '${probe.id}'`);
                    }

                    // Probe ids are client-wide so combined `/ping` output is stable and unambiguous.
                    const owner = Array.from(this.contributions.entries()).find(
                        ([ownerName, values]) => ownerName !== pluginName && values.healthProbes.has(probe.id)
                    );
                    if (owner) {
                        throw new PluginError(
                            `Plugin '${pluginName}' cannot register health probe '${probe.id}'; it is already provided by '${owner[0]}'`
                        );
                    }

                    contributions.healthProbes.set(probe.id, probe);
                    let registered = true;
                    return () => {
                        if (!registered) return;
                        registered = false;
                        if (contributions.healthProbes.get(probe.id) === probe) {
                            contributions.healthProbes.delete(probe.id);
                        }
                    };
                }
            }
        };
    }

    private getPluginContributions(pluginName: string): PluginContributions {
        const existing = this.contributions.get(pluginName);
        if (existing) return existing;

        const contributions: PluginContributions = {
            commands: new Map(),
            healthProbes: new Map()
        };
        this.contributions.set(pluginName, contributions);
        return contributions;
    }

    private validateCLICommand(pluginName: string, command: CLICommand): void {
        const triggers = [command.name, ...(command.aliases ?? [])];
        if (new Set(triggers).size !== triggers.length) {
            throw new PluginError(`Plugin '${pluginName}' registered duplicate triggers for CLI command '/${command.name}'`);
        }

        for (const trigger of triggers) {
            if (!/^[a-z][a-z0-9-]*$/.test(trigger)) {
                throw new PluginError(
                    `Plugin '${pluginName}' registered invalid CLI command trigger '${trigger}'; use lowercase letters, numbers, and hyphens`
                );
            }
            if (CORE_CLI_COMMAND_NAMES.has(trigger)) {
                throw new PluginError(`Plugin '${pluginName}' cannot replace core CLI command '/${trigger}'`);
            }

            const collision = Array.from(this.contributions.entries()).find(([, values]) =>
                Array.from(values.commands.values()).some(entry => [entry.name, ...(entry.aliases ?? [])].includes(trigger))
            );
            if (collision) {
                throw new PluginError(
                    `Plugin '${pluginName}' cannot register CLI trigger '/${trigger}'; it is already provided by '${collision[0]}'`
                );
            }
        }
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
