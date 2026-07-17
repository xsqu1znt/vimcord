import type { Interface as ReadlineInterface } from "node:readline";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CLICommand, CLICommandContext, CLIOptions, ParsedCLICommand } from "./types.js";

import { createInterface } from "node:readline";
import { Vimcord as VimcordClient } from "@/client/Vimcord.js";
import { activateCLIController, deactivateCLIController } from "./clientState.js";
import { CLILogger } from "./CLILogger.js";
import { createBuiltinCLICommands } from "./commands/index.js";
import { getCLIFlagValue, getCLIFlagValues, parseCLIInput } from "./parser.js";

/** Single process-wide stdin command runtime shared by opted-in Vimcord clients. */
export class VimcordCLI {
    /** Resolved process-wide configuration. */
    readonly options: Required<CLIOptions>;
    /** Dedicated CLI logger and output utilities. */
    readonly logger: CLILogger;

    private readonly clients = new Map<string, Vimcord>();
    private readonly coreCommands: readonly CLICommand[];
    private readonly handleClientCreate = (client: Vimcord): void => this.syncClient(client);
    private readonly handleClientDestroy = (clientId: string): void => this.removeClient(clientId);
    private readonly handleReadlineClose = (): void => {
        if (!this.readline) return;
        this.readline = null;
        this.stop();
    };
    private readline: ReadlineInterface | null = null;
    private selectedClientId: string | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private activeCommand: AbortController | null = null;
    private started = false;

    /** @internal Use `setupCLI()` to initialize the process singleton. */
    constructor(
        options: CLIOptions = {},
        private readonly onStop?: () => void
    ) {
        this.options = { loaders: "auto", ...options };
        this.logger = new CLILogger(this.options.loaders);
        this.coreCommands = createBuiltinCLICommands();
    }

    /** Starts stdin handling and attaches all eligible current and future clients. */
    start(): this {
        if (this.started) return this;

        activateCLIController(this);
        this.started = true;
        VimcordClient.$events.on("create", this.handleClientCreate);
        VimcordClient.$events.on("destroy", this.handleClientDestroy);
        for (const client of VimcordClient.$instances.values()) this.syncClient(client);

        // Hosting dashboards send each command as one stdin line; terminal prompting is intentionally disabled.
        this.readline = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
        this.readline.on("line", line => void this.execute(line));
        this.readline.once("close", this.handleReadlineClose);
        return this;
    }

    /** Stops stdin handling without destroying participating clients. */
    stop(): void {
        if (!this.started) return;

        this.activeCommand?.abort(new Error("CLI stopped"));
        this.activeCommand = null;
        this.readline?.off("close", this.handleReadlineClose);
        this.readline?.close();
        this.readline = null;
        VimcordClient.$events.off("create", this.handleClientCreate);
        VimcordClient.$events.off("destroy", this.handleClientDestroy);
        this.clients.clear();
        this.selectedClientId = null;
        this.started = false;
        deactivateCLIController(this);
        this.onStop?.();
    }

    /** Queues a slash-prefixed input line for serial execution. */
    execute(input: string): Promise<void> {
        this.commandQueue = this.commandQueue
            .then(() => this.executeInput(input))
            .catch(error => this.logger.failure("Command Failed", this.getSelectedClient(), error));
        return this.commandQueue;
    }

    /** Returns participating clients in stable attachment order. */
    getClients(): readonly Vimcord[] {
        return Array.from(this.clients.values());
    }

    /** Returns the currently selected client, if one remains available. */
    getSelectedClient(): Vimcord | null {
        return this.selectedClientId ? (this.clients.get(this.selectedClientId) ?? null) : null;
    }

    /** Selects a participating client by id, app name, Discord id, username, or tag. */
    selectClient(query: string): Vimcord {
        const client = this.resolveClient(query);
        this.selectedClientId = client.id;
        return client;
    }

    /** Resolves a participating client and rejects ambiguous display-name matches. */
    resolveClient(query: string): Vimcord {
        const direct = this.clients.get(query);
        if (direct) return direct;

        const normalized = query.toLowerCase();
        const matches = this.getClients().filter(client =>
            [client.$name, client.user?.id, client.user?.username, client.user?.tag]
                .filter((value): value is string => Boolean(value))
                .some(value => value.toLowerCase() === normalized)
        );
        if (!matches.length) throw new Error(`No CLI client matches '${query}'`);
        if (matches.length > 1) {
            throw new Error(`Client '${query}' is ambiguous; use one of: ${matches.map(client => client.id).join(", ")}`);
        }

        return matches[0]!;
    }

    /** Returns core commands and contributions available for a selected client. */
    getAvailableCommands(client: Vimcord | null = this.getSelectedClient()): readonly CLICommand[] {
        return [...this.coreCommands, ...(client?.plugins.getCLICommands().map(entry => entry.command) ?? [])];
    }

    /** Returns whether a client is actually participating in this running CLI. */
    hasClient(client: Vimcord): boolean {
        return this.started && this.clients.get(client.id) === client;
    }

    /** Adds or removes a client based on its current per-client `enableCLI` value. */
    syncClient(client: Vimcord): void {
        if (!this.started) return;

        if (!client.globals.app.enableCLI) {
            this.removeClient(client.id);
            return;
        }

        this.clients.set(client.id, client);
        this.selectedClientId ??= client.id;
    }

    private removeClient(clientId: string): void {
        if (!this.clients.delete(clientId)) return;
        if (this.selectedClientId === clientId) this.selectedClientId = this.clients.keys().next().value ?? null;
    }

    private findCommand(name: string, client: Vimcord | null): CLICommand | undefined {
        return this.getAvailableCommands(client).find(
            command => command.name === name || command.aliases?.includes(name) === true
        );
    }

    private resolveExecutionClients(parsed: ParsedCLICommand, command: CLICommand): readonly (Vimcord | null)[] {
        const requestedClient = getCLIFlagValue(parsed.flags, "client");
        if (requestedClient === "all") {
            if (!command.supportsAllClients) throw new Error(`/${command.name} does not support '--client all'`);
            if (!this.clients.size) throw new Error("No clients are participating in the CLI");
            return this.getClients();
        }

        const selected = requestedClient ? this.resolveClient(requestedClient) : this.getSelectedClient();
        if ((command.requiresClient ?? true) && !selected) {
            throw new Error("No client is selected; use /clients and /use <client>");
        }
        return [selected];
    }

    private async executeInput(input: string): Promise<void> {
        let parsed: ParsedCLICommand | null;
        try {
            parsed = parseCLIInput(input);
        } catch (error) {
            this.logger.failure("Invalid Command", this.getSelectedClient(), error);
            return;
        }
        if (!parsed) return;

        const targetQuery = getCLIFlagValue(parsed.flags, "client");
        let lookupClient = this.getSelectedClient();
        try {
            if (getCLIFlagValues(parsed.flags, "client").length > 1) {
                throw new Error("--client accepts one client id or 'all'");
            }
            if (targetQuery && targetQuery !== "all") lookupClient = this.resolveClient(targetQuery);
        } catch (error) {
            this.logger.failure("Client Not Found", lookupClient, error);
            return;
        }

        const command = this.findCommand(parsed.name, lookupClient);
        if (!command) {
            this.logger.header("Unknown Command", lookupClient);
            this.logger.line(`No CLI command named ${this.logger.styles.command(`/${parsed.name}`)} is available.`);
            this.logger.line(this.logger.styles.muted("Use /help to view available commands."));
            return;
        }

        try {
            const executionClients = this.resolveExecutionClients(parsed, command);
            for (const client of executionClients) {
                const controller = new AbortController();
                this.activeCommand = controller;
                const context: CLICommandContext = {
                    cli: this,
                    logger: this.logger,
                    client,
                    clients: this.getClients(),
                    args: parsed.args,
                    flags: parsed.flags,
                    signal: controller.signal
                };
                await command.execute(context);
            }
        } catch (error) {
            this.logger.failure("Command Failed", lookupClient, error);
        } finally {
            this.activeCommand = null;
        }
    }
}
