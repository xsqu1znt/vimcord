import { VimcordError } from "./VimcordError.js";

export class ModuleError extends VimcordError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, "MODULE_ERROR", options);
        this.name = "ModuleError";
    }
}
