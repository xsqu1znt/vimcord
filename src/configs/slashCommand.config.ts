import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface VimcordSlashCommandConfig extends BaseCommandConfig<CommandType.Slash> {}

const defaultConfig: VimcordSlashCommandConfig = {
    logExecution: true
};

export function createVimcordSlashCommandConfig(
    options: PartialDeep<VimcordSlashCommandConfig> = {}
): VimcordSlashCommandConfig {
    return _.merge(defaultConfig, options);
}
