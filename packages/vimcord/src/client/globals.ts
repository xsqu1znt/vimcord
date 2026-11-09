import type { GlobalCommandHooks } from "@/commands/index.js";

import { getDevMode, getPackageJson } from "@/utils/process.js";

/** Application settings, staff configuration, and global command hooks. */
export interface VimcordGlobals {
    /** App globals. */
    app: AppGlobals;
    /** Staff globals. */
    staff: StaffGlobals;

    /** Command hook globals. */
    hooks?: GlobalCommandHooks;
}

/** Mutable application settings exposed by the client. */
export interface AppGlobals {
    /** Bot name displayed in logs and the startup banner. @default "Discord Bot" */
    name: string;
    /** Bot version displayed in logs. @default package.json version or "1.0.0" */
    version: string;

    /** Selects development tokens, status profiles, and UX colors. @default process --dev flag */
    devMode: boolean;

    /** Enables diagnostic logging. @default false */
    verbose: boolean;

    /** Logs delivery, preparation, and execution timings for completed commands. @default true */
    commandLogging: boolean;

    /** Includes this client in the process-wide CLI when `setupCLI()` has initialized it. @default true */
    enableCLI: boolean;

    /** Disables the Vimcord ASCII art banner on startup. @default false */
    disableBanner: boolean;
}

/** Resolved staff users, roles, and the guild used for role checks. */
export interface StaffGlobals {
    /** Discord user IDs granted bot staff access. */
    users: string[];
    /** Discord role IDs granted bot staff access in `guildId`. */
    roles: string[];
    /** The server used for staff role checks and command role fallbacks. */
    guildId: string | null;
}

/** Staff roles require a server to check them in. */
export type StaffOptions = {
    /** User IDs granted bot staff access. @default [] */
    users?: string[];
} & (
    | {
          /** Omit roles when no staff guild is configured. */
          roles?: never;
          /** Guild used for staff role checks. */
          guildId?: string;
      }
    | {
          /** Role IDs granted staff access in the configured guild. @default [] */
          roles: string[];
          /** Guild used for staff role checks. */
          guildId: string;
      }
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
