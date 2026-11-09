import { VimcordError } from "./VimcordError.js";

/** Reports a module loading or execution failure. */
export class ModuleError extends VimcordError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, "MODULE_ERROR", options);
        this.name = "ModuleError";
    }
}
