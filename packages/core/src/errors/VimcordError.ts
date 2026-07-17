export class VimcordError extends Error {
    /** Creates a framework error with a stable machine-readable code. */
    constructor(
        message: string,
        public readonly code: string
    ) {
        super(message);
        this.name = "VimcordError";
    }
}
