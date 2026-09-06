import { VimcordError } from "./VimcordError.js";

export class ModuleError extends VimcordError {
    constructor(message: string) {
        super(message, "MODULE_ERROR");
        this.name = "ModuleError";
    }
}
