import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface ContextCommandConfig extends BaseCommandConfig<CommandType.Context> {}

const defaultConfig: ContextCommandConfig = {
    enabled: true,
    logExecution: true
};

export function createContextCommandConfig(options: PartialDeep<ContextCommandConfig> = {}): ContextCommandConfig {
    return _.merge(defaultConfig, options);
}
