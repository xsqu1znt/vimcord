import type { Vimcord } from "@/client/Vimcord.js";

export interface VimcordPlugin {
    name: string;
    version: string;
    dependencies?: string[];

    install(client: Vimcord): void | Promise<void>;
    uninstall?(client: Vimcord): void | Promise<void>;
}
