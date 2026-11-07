import type { GlobalCommandHooks } from "@/commands/index.js";

import { getDevMode, getPackageJson } from "@/utils/process.js";

export interface VimcordGlobals {
    /** App globals. */
    app: AppGlobals;
    /** Staff globals. */
    staff: StaffGlobals;

    /** Command hook globals. */
    hooks?: GlobalCommandHooks;
}

export interface AppGlobals {
    /** The name of the bot displayed in logs and startup banner.
     * @accessible via `client.$name` for use in embeds, error messages, etc.
     */
    name: string;
    /** The current version of the bot displayed in logs and startup banner.
     * @accessible via `client.$version` for version commands or update notifications.
     * @default Extracted from your `package.json` version field. If not found, defaults to `1.0.0`.
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
     * @default false
     */
    verbose: boolean;

    /** Logs delivery, preparation, and execution timings for completed commands. @default true */
    commandLogging: boolean;

    /** Includes this client in the process-wide CLI when `setupCLI()` has initialized it.
     * @default true
     */
    enableCLI: boolean;

    /** Disables the Vimcord ASCII art banner on startup.
     * @default false
     */
    disableBanner: boolean;
}

export interface StaffGlobals {
    /** Discord user IDs granted bot staff access. */
    users: string[];
    /** Discord role IDs granted bot staff access in `guildId`. */
    roles: string[];
    /** The server used for staff role checks and command role fallbacks. */
    guildId: string | null;
}

/** Staff roles require a server to check them in. */
export type StaffOptions = { users?: string[] } & (
    { roles?: never; guildId?: string } | { roles: string[]; guildId: string }
);

export const defaultAppGlobals = (): AppGlobals => {
    const packageJson = getPackageJson();
    const version = typeof packageJson.version === "string" ? packageJson.version : "1.0.0";
    return {
        name: "Discord Bot",
        version,
        devMode: getDevMode(),
        verbose: false,
        commandLogging: true,
        enableCLI: true,
        disableBanner: false
    };
};

export const defaultStaffGlobals = (): StaffGlobals => ({ users: [], roles: [], guildId: null });
