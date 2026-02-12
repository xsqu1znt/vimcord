import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";

export interface SlashCommandConfig extends BaseCommandConfig<CommandType.Slash> {}

const defaultConfig: SlashCommandConfig = {
    logExecution: true
};

export function createSlashCommandConfig(options: PartialDeep<SlashCommandConfig> = {}): SlashCommandConfig {
    return _.merge(defaultConfig, options);
}
