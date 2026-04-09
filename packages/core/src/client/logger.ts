import { Logger } from "@vimcord/logger";

export class VimcordLogger extends Logger {
    constructor() {
        super({ prefix: "vimcord", prefixEmoji: "⚡" });
    }
}

export const vimcordLogger: VimcordLogger = new VimcordLogger();
