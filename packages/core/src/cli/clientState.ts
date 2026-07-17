import type { Vimcord } from "@/client/Vimcord.js";

interface CLIClientController {
    hasClient(client: Vimcord): boolean;
    syncClient(client: Vimcord): void;
}

let activeController: CLIClientController | undefined;

/** Installs the one process-wide controller used to resolve actual CLI participation. */
export function activateCLIController(controller: CLIClientController): void {
    if (activeController) throw new Error("The Vimcord CLI has already been initialized");
    activeController = controller;
}

/** Releases the controller when its CLI runtime stops. */
export function deactivateCLIController(controller: CLIClientController): void {
    if (activeController === controller) activeController = undefined;
}

/** Re-evaluates a client's opt-in state after creation or configuration changes. */
export function syncCLIClient(client: Vimcord): void {
    activeController?.syncClient(client);
}

/** Returns whether a client is currently attached to the running CLI. */
export function isCLIEnabledFor(client: Vimcord): boolean {
    return activeController?.hasClient(client) === true;
}
