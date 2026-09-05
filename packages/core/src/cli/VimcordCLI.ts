import type { Interface as ReadlineInterface } from "node:readline";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CLICommand, CLICommandContext, CLIOptions } from "./types.js";

import { createInterface } from "node:readline";
import { Vimcord as VimcordClient } from "@/client/Vimcord.js";
import { activateCLIController, deactivateCLIController } from "./clientState.js";
import { CLILogger } from "./CLILogger.js";
import { createBuiltinCLICommands } from "./commands/index.js";
import { hasCLIFlag, parseCLIInput } from "./parser.js";

/** Single process-wide stdin command runtime for the Vimcord client. */
export class VimcordCLI {
    /** Resolved process-wide configuration. */
    readonly options: Required<CLIOptions>;
    /** Dedicated CLI logger and output utilities. */
    readonly logger: CLILogger;

    private readonly coreCommands: readonly CLICommand[];
    private readonly handleClientCreate = (client: Vimcord): void => this.syncClient(client);
    private readonly handleClientDestroy = (client: Vimcord): void => this.detachClient(client);
    private readonly handleReadlineClose = (): void => {
        if (!this.readline) return;
        this.readline = null;
        this.stop();
    };
    private readline: ReadlineInterface | null = null;
    private client: Vimcord | null = null;
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

    /** Starts stdin handling and attaches the current or next eligible client. */
    start(): this {
        if (this.started) return this;

        activateCLIController(this);
        this.started = true;
        VimcordClient.$events.on("create", this.handleClientCreate);
        VimcordClient.$events.on("destroy", this.handleClientDestroy);
        const client = VimcordClient.getInstance();
        if (client) this.syncClient(client);

        // Hosting dashboards send each command as one stdin line; terminal prompting is intentionally disabled.
        this.readline = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
        this.readline.on("line", line => void this.execute(line));
        this.readline.once("close", this.handleReadlineClose);
        return this;
    }

    /** Stops stdin handling without destroying the attached client. */
    stop(): void {
        if (!this.started) return;

        this.activeCommand?.abort(new Error("CLI stopped"));
        this.activeCommand = null;
        this.readline?.off("close", this.handleReadlineClose);
        this.readline?.close();
        this.readline = null;
        VimcordClient.$events.off("create", this.handleClientCreate);
        VimcordClient.$events.off("destroy", this.handleClientDestroy);
        this.client = null;
        this.started = false;
        deactivateCLIController(this);
        this.onStop?.();
    }

    /** Queues a slash-prefixed input line for serial execution. */
    execute(input: string): Promise<void> {
        this.commandQueue = this.commandQueue
            .then(() => this.executeInput(input))
            .catch(error => this.logger.failure("Command Failed", this.getClient(), error));
        return this.commandQueue;
    }

    /** Returns the client attached to this running CLI. */
    getClient(): Vimcord | null {
        return this.client;
    }

    /** Returns core commands and contributions available for the attached client. */
    getAvailableCommands(client: Vimcord | null = this.getClient()): readonly CLICommand[] {
        return [...this.coreCommands, ...(client?.plugins.getCLICommands().map(entry => entry.command) ?? [])];
    }

    /** Returns whether the given client is attached to this running CLI. */
    hasClient(client: Vimcord): boolean {
        return this.started && this.client === client;
    }

    /** Attaches or detaches the client based on its current `enableCLI` value. */
    syncClient(client: Vimcord): void {
        if (!this.started || VimcordClient.getInstance() !== client) return;
        this.client = client.globals.app.enableCLI ? client : null;
    }

    private detachClient(client: Vimcord): void {
        if (this.client === client) this.client = null;
    }

    private findCommand(name: string, client: Vimcord | null): CLICommand | undefined {
        return this.getAvailableCommands(client).find(
            command => command.name === name || command.aliases?.includes(name) === true
        );
    }

    private async executeInput(input: string): Promise<void> {
        let parsed;
        try {
            parsed = parseCLIInput(input);
        } catch (error) {
            this.logger.failure("Invalid Command", this.getClient(), error);
            return;
        }
        if (!parsed) return;

        const client = this.getClient();
        const command = this.findCommand(parsed.name, client);
        if (!command) {
            this.logger.header("Unknown Command", client);
            this.logger.line(`No CLI command named ${this.logger.styles.command(`/${parsed.name}`)} is available.`);
            this.logger.line(this.logger.styles.muted("Use /help to view available commands."));
            return;
        }

        try {
            if (hasCLIFlag(parsed.flags, "client")) throw new Error("Unknown flag: --client");
            if ((command.requiresClient ?? true) && !client) throw new Error("No client is attached to the CLI");

            const controller = new AbortController();
            this.activeCommand = controller;
            const context: CLICommandContext = {
                cli: this,
                logger: this.logger,
                client,
                args: parsed.args,
                flags: parsed.flags,
                signal: controller.signal
            };
            await command.execute(context);
        } catch (error) {
            this.logger.failure("Command Failed", client, error);
        } finally {
            this.activeCommand = null;
        }
    }
}
