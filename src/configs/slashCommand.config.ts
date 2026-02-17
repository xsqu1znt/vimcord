import { createConfigFactory } from "@/utils/configUtils";
import { BaseCommandConfig, CommandType } from "@ctypes/command.base";

export interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash> {}

const defaultConfig: SlashCommandConfig = {
    logExecution: true
};

export const createSlashCommandConfig = createConfigFactory(defaultConfig);
