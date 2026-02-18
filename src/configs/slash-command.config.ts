import { createConfigFactory } from "@/utils/configFactory";
import { BaseCommandConfig, CommandType } from "@ctypes/command.base";

export interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash> {}

const defaultConfig: SlashCommandConfig = {
    enabled: true,
    logExecution: true
};

export const createSlashCommandConfig = createConfigFactory(defaultConfig);
