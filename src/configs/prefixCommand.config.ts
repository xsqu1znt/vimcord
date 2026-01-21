import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";
import { Vimcord } from "@/client";

export interface VimcordPrefixCommandConfig extends BaseCommandConfig<CommandType.Prefix> {
    /** @defaultValue ! */
    defaultPrefix: string;
    /** @defaultValue true */
    allowMentionAsPrefix: boolean;
    /** @defaultValue true */
    allowCaseInsensitiveCommandNames: boolean;
    /**
     * A custom resolver to fetch a guild-specific prefix.
     * Returns a string (the prefix) or null/undefined to fallback to default.
     */
    guildPrefixResolver?: (
        client: Vimcord,
        guildId: string
    ) => Promise<string | null | undefined> | string | null | undefined;
}

const defaultConfig: VimcordPrefixCommandConfig = {
    enabled: true,
    defaultPrefix: "!",
    allowMentionAsPrefix: true,
    allowCaseInsensitiveCommandNames: true,
    logExecution: true
};

export function createVimcordPrefixCommandConfig(
    options: PartialDeep<VimcordPrefixCommandConfig> = {}
): VimcordPrefixCommandConfig {
    return _.merge(defaultConfig, options);
}
