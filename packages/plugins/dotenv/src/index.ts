import type { DotenvConfigOptions } from "dotenv";

import { configDotenv } from "dotenv";
import { Vimcord, VimcordPlugin } from "@vimcord/core";

export const PLUGIN_NAME = "dotenv";
export const PLUGIN_DESCRIPTION = "Configures dotEnv to inject environment variables.";
export const PLUGIN_VERSION = "0.1.0";

export class DotEnvPlugin extends VimcordPlugin {
    override name = PLUGIN_NAME;
    override description = PLUGIN_DESCRIPTION;
    override version = PLUGIN_VERSION;

    constructor(private config?: DotenvConfigOptions) {
        super();
    }

    override install(client: Vimcord): void {
        configDotenv({ quiet: true, ...this.config });
        client.logger.plugin.success("dotenv", "Environment variables injected");
        this.installed = true;
    }

    override uninstall(): void {
        // noop
        this.installed = false;
    }
}
