import type { CLICommand, HealthProbe } from "@/cli/types.js";
import type { Vimcord } from "@/client/Vimcord.js";

/** Plugin-owned contribution registration. Contributions are removed automatically on uninstall. */
export interface VimcordPluginContext {
    /** Client installing the plugin. */
    client: Vimcord;
    /** Client-scoped CLI contribution API. */
    cli: {
        /** Registers a plugin command and returns an idempotent manual disposer. */
        registerCommand(command: CLICommand): () => void;
    };
    /** Client-scoped service health contribution API. */
    health: {
        /** Registers a health probe and returns an idempotent manual disposer. */
        register(probe: HealthProbe): () => void;
    };
}

export abstract class VimcordPlugin {
    abstract name: string;
    abstract description: string;
    abstract version: string;

    dependencies?: string[];
    installed: boolean = false;

    /** Installs the plugin and registers any client-scoped contributions. */
    abstract install(context: VimcordPluginContext): Promise<void> | void;
    /** Releases plugin resources. Registered contributions are removed automatically afterward. */
    abstract uninstall(context: VimcordPluginContext): Promise<void> | void;
}
