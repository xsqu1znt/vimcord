import { BaseCommandConfig, CommandType } from "@ctypes/command.base";
import { PartialDeep } from "type-fest";
import _ from "lodash";
import { Vimcord } from "@/client";

export interface PrefixCommandConfig extends BaseCommandConfig<CommandType.Prefix> {
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

const defaultConfig: PrefixCommandConfig = {
    enabled: true,
    defaultPrefix: "!",
    allowMentionAsPrefix: true,
    allowCaseInsensitiveCommandNames: true,
    logExecution: true
};

export function createPrefixCommandConfig(options: PartialDeep<PrefixCommandConfig> = {}): PrefixCommandConfig {
    return _.merge(defaultConfig, options);
}
