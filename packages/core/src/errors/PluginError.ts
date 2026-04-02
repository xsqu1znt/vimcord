import { VimcordError } from "./VimcordError.js";

export class PluginError extends VimcordError {
    constructor(message: string) {
        super(message, "PLUGIN_ERROR");
        this.name = "PluginError";
    }
}
