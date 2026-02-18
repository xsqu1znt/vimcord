import { createConfigFactory } from "@/utils/config.factory";
import { getDevMode, getPackageJson } from "@/utils/process.utils";

export interface AppConfig {
    /** The name of the bot displayed in logs and startup banner.
     * @accessible via `client.$name` for use in embeds, error messages, etc.
     */
    name: string;
    /** The current version of the bot displayed in logs and startup banner.
     * @accessible via `client.$version` for version commands or update notifications.
     * @defaultValue Extracted from your `package.json` version field. If not found, defaults to `1.0.0`.
     */
    version: string;

    /** Enables development mode for testing and debugging.
     *
     * **The way it works:**
     * - If the bot is ran with the `--dev` flag it will automatically be enabled
     * - Can be changed during runtime using the `client.$devMode` setter
     *
     * **What this does by default:**
     * - Automatically switches to `TOKEN_DEV` and `MONGO_URI_DEV` environment variables
     *
     * **Common use cases:**
     * - Use a separate Discord server, bot account, or database for testing
     * - Skip production-only behaviors like analytics tracking or email notifications
     * - Enable additional debug commands or verbose logging
     * - Switch between development and production API endpoints for your other services
     *
     * @accessible via `client.$devMode` to conditionally enable/disable your own features.
     *
     * @example
     * ```ts
     * // Use different API endpoints for your own services
     * const baseAPIUrl = client.$devMode
     *   ? 'http://localhost:3000'
     *   : 'https://api.production.com';
     * ```
     */
    devMode: boolean;

    /** Enables verbose console logging with additional debug information.
     * @accessible via `client.$verboseMode`
     * @defaultValue false
     */
    verbose: boolean;

    /** Enables the Vimcord CLI.
     * @defaultValue false
     */
    enableCLI: boolean;

    /** Disables the Vimcord ASCII art banner on startup.
     * @defaultValue false
     */
    disableBanner: boolean;
}

const defaultConfig: AppConfig = {
    name: "Discord Bot",
    version: getPackageJson()?.version ?? "1.0.0",
    devMode: getDevMode(),
    verbose: false,
    enableCLI: false,
    disableBanner: false
};

export const createAppConfig = createConfigFactory(defaultConfig, config => {
    if (!config.name) throw new Error("App name is required");
});
