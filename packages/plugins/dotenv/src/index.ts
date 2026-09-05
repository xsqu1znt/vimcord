import type { DotenvConfigOptions } from "dotenv";
import type { VimcordPluginContext } from "@vimcord/core";

import { configDotenv } from "dotenv";
import { getPackageVersion, VimcordPlugin } from "@vimcord/core";

export const PLUGIN_NAME = "dotenv";
export const PLUGIN_DESCRIPTION = "Configures dotEnv to inject environment variables.";
export const PLUGIN_VERSION = getPackageVersion("@vimcord/plugin-dotenv", "packages/plugins/dotenv") ?? "unknown";

export class DotEnvPlugin extends VimcordPlugin {
    override name = PLUGIN_NAME;
    override description = PLUGIN_DESCRIPTION;
    override version = PLUGIN_VERSION;

    constructor(private config?: DotenvConfigOptions) {
        super();
    }

    override install({ client }: VimcordPluginContext): void {
        configDotenv({ quiet: true, ...this.config });
        client.logger.plugin.success("dotenv", "Environment variables injected");
    }
}
