import type { HealthProbe } from "@/cli/types.js";
import type { Vimcord } from "@/client/Vimcord.js";

/** Plugin-owned contribution registration. Health probes are removed automatically on uninstall. */
export interface VimcordPluginContext {
    /** Client installing the plugin. */
    client: Vimcord;
    /** Client-scoped service health contribution API. */
    health: {
        /** Registers a health probe. */
        register(probe: HealthProbe): void;
    };
}

export abstract class VimcordPlugin {
    abstract name: string;
    abstract description: string;
    abstract version: string;

    dependencies?: string[];

    /** Installs the plugin and registers any client-scoped contributions. */
    abstract install(context: VimcordPluginContext): Promise<void> | void;
    /** Releases plugin-owned resources. Registered health probes are removed automatically afterward. */
    uninstall?(): Promise<void> | void;
}
