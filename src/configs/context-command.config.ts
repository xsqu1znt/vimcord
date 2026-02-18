import { createConfigFactory } from "@/utils/configFactory";
import { BaseCommandConfig, CommandType } from "@ctypes/command.base";

export interface ContextCommandConfig extends BaseCommandConfig<CommandType.Context> {}

const defaultConfig: ContextCommandConfig = {
    enabled: true,
    logExecution: true
};

export const createContextCommandConfig = createConfigFactory(defaultConfig);
