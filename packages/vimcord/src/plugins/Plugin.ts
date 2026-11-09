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

/** Base for plugins installed and released by the client lifecycle. */
export abstract class VimcordPlugin {
    /** Name displayed in logs or command discovery. */
    abstract name: string;
    /** Short description displayed to users or in discovery. */
    abstract description: string;
    /** Version displayed in logs and plugin discovery. */
    abstract version: string;

    /** Plugin names that must be installed first. @default [] */
    dependencies?: string[];

    /** Installs the plugin and registers any client-scoped contributions. */
    abstract install(context: VimcordPluginContext): Promise<void> | void;
    /** Runs during `login()` once every plugin is installed, before modules load and the gateway connects. Use it for work that needs other plugins. Throwing aborts login and uninstalls every plugin. */
    onPluginsInstalled?(context: VimcordPluginContext): Promise<void> | void;
    /** Releases plugin-owned resources. Registered health probes are removed automatically afterward. */
    uninstall?(): Promise<void> | void;
}
