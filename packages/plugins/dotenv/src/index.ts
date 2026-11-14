import type { DotenvConfigOptions } from "dotenv";
import type { VimcordPluginContext } from "vimcord";

import { configDotenv } from "dotenv";
import { getPackageVersion, VimcordPlugin } from "vimcord";

/** Stable name used to register the dotenv plugin. */
export const PLUGIN_NAME = "dotenv";
/** Description of the dotenv plugin. */
export const PLUGIN_DESCRIPTION = "Configures dotEnv to inject environment variables.";
/** Installed version of the dotenv plugin. */
export const PLUGIN_VERSION = getPackageVersion("@vimcord/plugin-dotenv", "packages/plugins/dotenv") ?? "unknown";

/** Loads environment variables before later plugins and login read them. */
export class DotEnvPlugin extends VimcordPlugin {
    /** Name displayed in logs or command discovery. */
    override name = PLUGIN_NAME;
    /** Short description displayed to users or in discovery. */
    override description = PLUGIN_DESCRIPTION;
    /** Version displayed in logs and plugin discovery. */
    override version = PLUGIN_VERSION;

    constructor(private config?: DotenvConfigOptions) {
        super();
    }

    /** Acquires plugin resources during client login. */
    override install({ client }: VimcordPluginContext): void {
        configDotenv({ quiet: true, ...this.config });
        client.logger.plugin.success("dotenv", "Environment variables injected");
    }
}
