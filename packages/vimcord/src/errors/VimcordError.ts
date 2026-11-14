/** Framework error with a machine-readable category and optional cause. */
export class VimcordError extends Error {
    /** Creates a framework error with a stable machine-readable code. */
    constructor(
        message: string,
        public readonly code: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "VimcordError";
    }
}
