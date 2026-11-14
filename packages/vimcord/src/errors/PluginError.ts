import { VimcordError } from "./VimcordError.js";

/** Reports a plugin lifecycle failure. */
export class PluginError extends VimcordError {
    constructor(message: string) {
        super(message, "PLUGIN_ERROR");
        this.name = "PluginError";
    }
}
