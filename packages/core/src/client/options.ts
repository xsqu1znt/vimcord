import { getDevMode, getPackageJson } from "@/utils/processUtils.js";

export interface AppOptions {
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

export const defaultAppOptions = (): AppOptions => {
    const packageJson = getPackageJson();
    const version = typeof packageJson.version === "string" ? packageJson.version : "1.0.0";
    return {
        name: "Discord Bot",
        version,
        devMode: getDevMode(),
        verbose: false,
        enableCLI: false,
        disableBanner: false
    };
};

export interface StaffOptions {
    /** The Discord user ID of the bot owner. */
    ownerId: string | null;
    /** Discord user IDs granted superuser privileges. */
    superUsers: string[];
    /** Discord role IDs granted superuser privileges. */
    superUserRoles: string[];
    /** Per-command user ID overrides that bypass normal permission checks. */
    bypassers: { commandName: string; userIds: string[] }[];
    /** Controls which staff roles bypass guild administrator permission checks. */
    bypassesGuildAdmin: {
        /** Applies to all staff roles. */
        allBotStaff: boolean;
        /** Applies to the bot owner. */
        botOwner: boolean;
        /** Applies to superusers. */
        superUsers: boolean;
        /** Applies to bypassers. */
        bypassers: boolean;
    };
    /** The bot's associated Discord guild. */
    guild: {
        /** The guild ID. */
        id: string | null;
        /** An invite URL to the guild. */
        inviteUrl: string | null;
        /** Named channel IDs for use throughout the bot. */
        channels: Record<string, string>;
    };
}

export const defaultStaffOptions = (): StaffOptions => {
    return {
        ownerId: null,
        superUsers: [],
        superUserRoles: [],
        bypassers: [],
        bypassesGuildAdmin: {
            allBotStaff: false,
            botOwner: false,
            superUsers: false,
            bypassers: false
        },
        guild: {
            id: null,
            inviteUrl: null,
            channels: {}
        }
    };
};
