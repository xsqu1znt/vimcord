import type { CLIOptions } from "./types.js";

import { VimcordCLI } from "./VimcordCLI.js";

let activeCLI: VimcordCLI | undefined;

/** Initializes the one process-wide, promptless Vimcord CLI. */
export function setupCLI(options: CLIOptions = {}): VimcordCLI {
    if (activeCLI) throw new Error("The Vimcord CLI has already been initialized");

    const cli = new VimcordCLI(options, () => {
        if (activeCLI === cli) activeCLI = undefined;
    });
    activeCLI = cli;

    try {
        return cli.start();
    } catch (error) {
        cli.stop();
        activeCLI = undefined;
        throw error;
    }
}

/** Returns the active process CLI, when `setupCLI()` has initialized one. */
export function getCLI(): VimcordCLI | undefined {
    return activeCLI;
}
