import { createConfigFactory } from "@/utils/config.factory";
import { BaseCommandConfig, CommandType } from "@ctypes/command.base";

export interface ContextCommandConfig extends BaseCommandConfig<CommandType.Context> {}

const defaultConfig: ContextCommandConfig = {
    enabled: true,
    logExecution: true
};

export const createContextCommandConfig = createConfigFactory(defaultConfig);
