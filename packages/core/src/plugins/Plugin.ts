import type { Vimcord } from "@/client/Vimcord.js";

export abstract class VimcordPlugin {
    abstract name: string;
    abstract description: string;
    abstract version: string;

    dependencies?: string[];
    installed: boolean = false;

    abstract install(client: Vimcord): void;
    abstract uninstall(client: Vimcord): void;
}
