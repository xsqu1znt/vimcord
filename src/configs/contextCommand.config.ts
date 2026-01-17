import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface VimcordContextCommandConfig extends BaseCommandConfig<CommandType.Context> {}

const defaultConfig: VimcordContextCommandConfig = {
    enabled: true,
    logExecution: true
};

export function createVimcordContextCommandConfig(
    options: PartialDeep<VimcordContextCommandConfig> = {}
): VimcordContextCommandConfig {
    return _.merge(defaultConfig, options);
}
