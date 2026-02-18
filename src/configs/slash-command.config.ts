import { createConfigFactory } from "@/utils/config.factory";
import { BaseCommandConfig, CommandType } from "@ctypes/command.base";

export interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash> {}

const defaultConfig: SlashCommandConfig = {
    logExecution: true
};

export const createSlashCommandConfig = createConfigFactory(defaultConfig);
