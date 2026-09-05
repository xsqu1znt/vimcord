import type { Vimcord } from "@/client/Vimcord.js";
import type { LoaderMode } from "@/utils/Logger.js";
import type { CLILogger } from "./CLILogger.js";
import type { VimcordCLI } from "./VimcordCLI.js";

/** Process-wide Vimcord CLI configuration. */
export interface CLIOptions {
    /** Controls animated command loaders. @default "auto" */
    loaders?: LoaderMode;
}

/** Parsed command-line input. Flag names are normalized to lowercase. */
export interface ParsedCLICommand {
    /** Normalized command name without the leading slash. */
    name: string;
    /** Positional values written before long flags. */
    args: readonly string[];
    /** Long flags and all values consumed by each flag. */
    flags: ReadonlyMap<string, readonly string[]>;
}

/** Runtime data passed to a CLI command. */
export interface CLICommandContext {
    /** Process-wide CLI runtime executing the command. */
    cli: VimcordCLI;
    /** Dedicated CLI output and formatting API. */
    logger: CLILogger;
    /** Attached client, or `null` for client-independent commands. */
    client: Vimcord | null;
    /** Parsed positional arguments. */
    args: readonly string[];
    /** Parsed long flags. */
    flags: ReadonlyMap<string, readonly string[]>;
    /** Cancels when the runtime stops the active command. */
    signal: AbortSignal;
}

/** A core or plugin-provided CLI command. */
export interface CLICommand {
    /** Lowercase command name without a leading slash. */
    name: string;
    /** One-line explanation displayed by `/help`. */
    description: string;
    /** Usage text displayed by `/help`. */
    usage?: string;
    /** Additional lowercase command triggers. */
    aliases?: readonly string[];
    /** Whether the attached client is required. Plugin commands should leave this enabled. @default true */
    requiresClient?: boolean;
    /** Executes the command for its resolved target. */
    execute(context: CLICommandContext): Promise<void> | void;
}

/** Result returned by a plugin health probe. */
export interface HealthProbeResult {
    /** Service availability reported by the provider. */
    status: "healthy" | "degraded" | "unavailable";
    /** Measured round-trip time, when the provider can report one. */
    latencyMs?: number;
    /** Optional provider-specific status explanation. */
    detail?: string;
}

/** Context passed to plugin health checks. */
export interface HealthProbeContext {
    /** Client that owns the plugin contribution. */
    client: Vimcord;
    /** Aborts when the probe times out or the active CLI command stops. */
    signal: AbortSignal;
}

/** A client-scoped service health contribution registered by a plugin. */
export interface HealthProbe {
    /** Client-wide stable identifier. */
    id: string;
    /** Human-readable service name. */
    label: string;
    /** Maximum check duration before the CLI reports the service as unavailable. @default 2000 */
    timeout?: number;
    /** Measures current service availability. */
    check(context: HealthProbeContext): Promise<HealthProbeResult> | HealthProbeResult;
}

/** A health probe paired with its owning plugin. */
export interface RegisteredHealthProbe {
    /** Plugin that registered the probe. */
    pluginName: string;
    /** Registered provider. */
    probe: HealthProbe;
}

/** A CLI command paired with its owning plugin. */
export interface RegisteredCLICommand {
    /** Plugin that registered the command. */
    pluginName: string;
    /** Registered command. */
    command: CLICommand;
}
