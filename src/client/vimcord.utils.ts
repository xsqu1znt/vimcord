import { createAppConfig } from "@/configs/app.config";
import { createContextCommandConfig } from "@/configs/context-command.config";
import { createPrefixCommandConfig } from "@/configs/prefix-command.config";
import { createSlashCommandConfig } from "@/configs/slash-command.config";
import { createStaffConfig } from "@/configs/staff.config";
import { PartialDeep } from "@/types/helpers";
import { ClientOptions } from "discord.js";
import { Vimcord } from "./Vimcord";
import { AppModuleImports, ModuleImportOptions, VimcordConfig, VimcordFeatures } from "./vimcord.types";

export const DEFAULT_MODULE_SUFFIXES = {
    slashCommands: ".slash",
    contextCommands: ".ctx",
    prefixCommands: ".prefix",
    events: ".event"
} as const;

export const configSetters: Record<
    keyof VimcordConfig,
    (
        options: PartialDeep<VimcordConfig[keyof VimcordConfig]>,
        existing?: VimcordConfig[keyof VimcordConfig]
    ) => VimcordConfig[keyof VimcordConfig]
> = {
    app: createAppConfig as any,
    staff: createStaffConfig as any,
    slashCommands: createSlashCommandConfig as any,
    contextCommands: createContextCommandConfig as any,
    prefixCommands: createPrefixCommandConfig as any
};

export const moduleImporters: Record<
    keyof AppModuleImports,
    (client: Vimcord, options: AppModuleImports[keyof AppModuleImports], set?: boolean) => any
> = {
    slashCommands: (client, options, set) => {
        const opt = options as ModuleImportOptions | undefined;
        const dir = Array.isArray(options) ? options : typeof options === "string" ? options : (options?.dir ?? []);
        const suffix = Array.isArray(options)
            ? DEFAULT_MODULE_SUFFIXES.slashCommands
            : (opt?.suffix ?? DEFAULT_MODULE_SUFFIXES.slashCommands);
        return client.commands.slash.importFrom(dir, set, suffix);
    },
    contextCommands: (client, options, set) => {
        const opt = options as ModuleImportOptions | undefined;
        const dir = Array.isArray(options) ? options : typeof options === "string" ? options : (options?.dir ?? []);
        const suffix = Array.isArray(options)
            ? DEFAULT_MODULE_SUFFIXES.contextCommands
            : (opt?.suffix ?? DEFAULT_MODULE_SUFFIXES.contextCommands);
        return client.commands.context.importFrom(dir, set, suffix);
    },
    prefixCommands: (client, options, set) => {
        const opt = options as ModuleImportOptions | undefined;
        const dir = Array.isArray(options) ? options : typeof options === "string" ? options : (options?.dir ?? []);
        const suffix = Array.isArray(options)
            ? DEFAULT_MODULE_SUFFIXES.prefixCommands
            : (opt?.suffix ?? DEFAULT_MODULE_SUFFIXES.prefixCommands);
        return client.commands.prefix.importFrom(dir, set, suffix);
    },
    events: (client, options, set) => {
        const opt = options as ModuleImportOptions | undefined;
        const dir = Array.isArray(options) ? options : typeof options === "string" ? options : (options?.dir ?? []);
        const suffix = Array.isArray(options)
            ? DEFAULT_MODULE_SUFFIXES.events
            : (opt?.suffix ?? DEFAULT_MODULE_SUFFIXES.events);
        return client.events.importFrom(dir, set, suffix);
    }
};

export function defineClientOptions(options: ClientOptions) {
    return options;
}

export function defineVimcordFeatures(features: VimcordFeatures) {
    return features;
}

export function defineVimcordConfig(config: PartialDeep<VimcordConfig>): VimcordConfig {
    return {
        app: createAppConfig(config.app),
        staff: createStaffConfig(config.staff),
        slashCommands: createSlashCommandConfig(config.slashCommands),
        prefixCommands: createPrefixCommandConfig(config.prefixCommands),
        contextCommands: createContextCommandConfig(config.contextCommands)
    };
}

/**
 * Returns an instance of Vimcord.
 * @param clientId [default: 0]
 */
export function useClient(clientId?: number) {
    return Vimcord.getInstance(clientId);
}

/**
 * Waits for a Vimcord instance to be ready.
 * @param clientId [default: 0]
 * @param timeoutMs [default: 60000]
 */
export function useReadyClient(clientId?: number, timeoutMs?: number) {
    return Vimcord.getReadyInstance(clientId, timeoutMs);
}

/**
 * Creates a new instance of Vimcord.
 */
<<<<<<< HEAD
export function createClient(
    options: import("discord.js").ClientOptions,
    features?: import("./vimcord.types").VimcordFeatures,
    config?: import("type-fest").PartialDeep<import("./vimcord.types").VimcordConfig>
) {
=======
export function createClient(options: ClientOptions, features?: VimcordFeatures, config?: PartialDeep<VimcordConfig>) {
>>>>>>> dev
    return Vimcord.create(options, features, config);
}
