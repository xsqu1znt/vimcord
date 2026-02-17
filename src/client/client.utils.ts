import { createAppConfig } from "@/configs/app.config";
import { createContextCommandConfig } from "@/configs/contextCommand.config";
import { createPrefixCommandConfig } from "@/configs/prefixCommand.config";
import { createSlashCommandConfig } from "@/configs/slashCommand.config";
import { createStaffConfig } from "@/configs/staff.config";
import { VimcordConfig } from "./client.types";
import { PartialDeep } from "type-fest";

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
    prefixCommands: createPrefixCommandConfig as any,
    contextCommands: createContextCommandConfig as any
};

export function createVimcordConfig(config: PartialDeep<VimcordConfig>) {
    return {
        app: createAppConfig(config.app),
        staff: createStaffConfig(config.staff),
        slashCommands: createSlashCommandConfig(config.slashCommands),
        prefixCommands: createPrefixCommandConfig(config.prefixCommands),
        contextCommands: createContextCommandConfig(config.contextCommands)
    };
}
