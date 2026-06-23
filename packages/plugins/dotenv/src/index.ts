import type { DotenvConfigOptions } from "dotenv";

import { configDotenv } from "dotenv";
import { Vimcord, VimcordPlugin } from "@vimcord/core";

export class DotEnvPlugin extends VimcordPlugin {
    override name = "@vimcord/plugin-dotenv";
    override description = "Configures dotEnv to inject environment variables.";
    override version = "0.1.0";

    constructor(private config?: DotenvConfigOptions) {
        super();
    }

    override install(client: Vimcord): void {
        configDotenv({ quiet: true, ...this.config });
        client.logger.plugin("dotenv", "Environment variables injected");
        this.installed = true;
    }

    override uninstall(): void {
        // noop
        this.installed = false;
    }
}
