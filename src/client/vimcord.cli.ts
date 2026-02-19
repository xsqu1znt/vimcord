import { Logger } from "@/tools/Logger";
import { createInterface, Interface } from "node:readline";
import { $ } from "qznt";
import { useClient } from "@/client";

export type VimcordCLIMode = "on" | "off";

export interface VimcordCLIOptions {
    prefix: string;
}

export class VimcordCLI {
    static mode: VimcordCLIMode = "off";

    static setMode(mode: VimcordCLIMode) {
        if (VimcordCLI.mode === mode) return;
        VimcordCLI.mode = mode;

        if (mode === "on") {
            CLI.logger.log(`~ Type ${CLI.options.prefix}help to view available commands`);
        } else {
            CLI.logger.log(`~ Updated mode to "${mode}"`);
        }
    }

    rl: Interface;
    options: VimcordCLIOptions;

    commands = new Map<string, { description: string; fn: (args: string[], content: string) => void }>();
    logger = new Logger({ prefixEmoji: "🚀", prefix: "CLI", showTimestamp: false });

    constructor(options: VimcordCLIOptions) {
        this.options = options;

        this.rl = createInterface({
            input: process.stdin as any as NodeJS.ReadableStream,
            output: process.stdout as any as NodeJS.WritableStream,
            terminal: false
        });

        this.rl.on("line", line => {
            if (VimcordCLI.mode !== "on") return;

            const { isCommand, commandName, content, args } = this.parseLine(line);
            if (!isCommand) return;
            const command = this.commands.get(commandName!);
            if (!command) {
                const nearestMatches = Array.from(this.commands.keys()).filter(cmd =>
                    cmd.toLowerCase().includes(commandName!.toLowerCase())
                );
                return this.logger.error(
                    `Unknown command '${commandName}'${nearestMatches.length ? `. Did you mean ${nearestMatches.length > 1 ? `[${nearestMatches.map(m => `'${this.options.prefix}${m}'`).join(", ")}]` : `'${this.options.prefix}${nearestMatches[0]}'`}?` : ""}`
                );
            }
            command.fn(args!, content!);
        });
    }

    private parseLine(line: string) {
        if (line.startsWith(this.options.prefix)) {
            // Remove the prefix
            line = line.slice(this.options.prefix.length);
        } else {
            return { isCommand: false };
        }

        const args = line.split(" ").map(s => s.trim());
        const commandName = args.shift();

        return { isCommand: true, commandName, content: args.join(" "), args };
    }

    getClientInstance(line: string) {
        const clientIndex = $.str.getFlag(line, "--client", 1) || $.str.getFlag(line, "-c", 1);

        if (clientIndex) {
            const idx = Number(clientIndex);
            if (isNaN(idx)) {
                CLI.logger.error(`'${clientIndex}' is not a valid number`);
                return undefined;
            }
            const client = useClient(idx);
            if (!client) {
                CLI.logger.error("Client instance not found");
                return undefined;
            }
            return client;
        } else {
            // Fallback to the first client
            const client = useClient(0);
            if (!client) {
                CLI.logger.error("Client instance not found");
                return undefined;
            }
            return client;
        }
    }

    addCommand(commandName: string, description: string, fn: (args: string[], content: string) => void) {
        this.commands.set(commandName, { description, fn });
    }

    removeCommand(commandName: string) {
        if (!this.commands.has(commandName)) return false;
        this.commands.delete(commandName);
        return true;
    }
}

/* Create and export a singleton instance */
export let CLI = new VimcordCLI({ prefix: "/" });

// TODO: Add /events ~ List loaded events
CLI.addCommand("help", "View information about a command, or the available CLI options", args => {
    const prefix = CLI.options.prefix;
    const helpList: Record<string, string> = {};

    for (const cmd of CLI.commands.entries()) {
        const commandName = cmd[0];
        const commandDescription = cmd[1].description;
        helpList[`${prefix}${commandName}`] = `~ ${commandDescription}`;
    }

    CLI.logger.table("(help)", helpList);
});

CLI.addCommand("register", "Register app commands (slash & context) globally, or per guild", async (args, content) => {
    const client = CLI.getClientInstance(content);
    if (!client) return;

    const mode = args[0]?.toLowerCase() || "";
    if (!["guild", "global"].includes(mode)) {
        return CLI.logger.error(`'${mode}' is not a valid option. Your options are [guild|global]`);
    }

    // Parse guild flags
    let guildIds = ($.str.getFlag(content, "--guilds", 1) || $.str.getFlag(content, "-g", 1) || "")
        .replaceAll(/["']/g, "")
        .split(" ")
        .filter(Boolean)
        .map(s => s.replaceAll(",", "").trim());

    if (!guildIds.length) guildIds = client.guilds.cache.map(g => g.id);

    switch (mode) {
        case "guild":
            CLI.logger.info("Registering guild commands...");
            await client.commands.registerGuild({ guilds: guildIds });
            break;

        case "global":
            CLI.logger.info("Registering global commands...");
            await client.commands.registerGlobal();
            break;
    }
});

CLI.addCommand("unregister", "Unregister app commands globally, or per guild", async (args, content) => {
    const client = CLI.getClientInstance(content);
    if (!client) return;

    const mode = args[0]?.toLowerCase() || "";
    if (!["guild", "global"].includes(mode)) {
        return CLI.logger.error(`'${mode}' is not a valid option. Your options are [guild|global]`);
    }

    let guildIds = ($.str.getFlag(content, "--guilds", 1) || $.str.getFlag(content, "-g", 1) || "")
        .replaceAll(/["']/g, "")
        .split(" ")
        .filter(Boolean)
        .map(s => s.replaceAll(",", "").trim());

    if (!guildIds.length) guildIds = client.guilds.cache.map(g => g.id);

    switch (mode) {
        case "guild":
            CLI.logger.info("Unregistering guild commands...");
            await client.commands.unregisterGuild({ guilds: guildIds });
            break;

        case "global":
            CLI.logger.info("Unregistering global commands...");
            await client.commands.unregisterGlobal();
            break;
    }
});

CLI.addCommand("stats", "View statistics about a client instance", (args, content) => {
    const client = CLI.getClientInstance(content);
    if (!client) return;

    CLI.logger.table(`(stats) ~ ${client.config.app.name}`, {
        "Guilds:": $.format.number(client.guilds.cache.size),
        "Ping:": `${client.ws.ping || 0}ms`,
        "Uptime:": `${$.math.secs(client.uptime || 0)}s`,
        "Process Uptime:": `${Math.floor(process.uptime())}s`,
        "Memory Usage:": `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`
    });
});

CLI.addCommand("cmds", "List the loaded commands", async (args, content) => {
    const client = CLI.getClientInstance(content);
    if (!client) return;

    // Default to slash if no mode is provided
    const mode = (args[0] || "slash").toLowerCase();

    switch (mode) {
        case "slash": {
            const commands = Array.from(client.commands.slash.commands.values());
            // Sort by builder name
            commands.sort((a, b) => a.builder.name.localeCompare(b.builder.name));

            const tableData: Record<string, string> = {};
            for (const cmd of commands) {
                tableData[`/${cmd.builder.name}`] = `~ ${cmd.builder.description || "No description"}`;
            }

            return CLI.logger.table(`(cmds) ~ slash (${$.format.number(commands.length)})`, tableData);
        }

        case "prefix": {
            const commands = Array.from(client.commands.prefix.commands.values());
            commands.sort((a, b) => {
                const nameA = a.toConfig().name;
                const nameB = b.toConfig().name;
                return nameA.localeCompare(nameB);
            });

            const tableData: Record<string, string> = {};
            const defaultPrefix = client.config.prefixCommands.defaultPrefix;

            for (const cmd of commands) {
                const config = cmd.toConfig();
                const aliasIndicator = config.aliases?.length ? ` [${config.aliases.join(", ")}]` : "";

                tableData[`${defaultPrefix}${config.name}${aliasIndicator}`] = `~ ${config.description || "No description"}`;
            }

            return CLI.logger.table(`(cmds) ~ prefix (${$.format.number(commands.length)})`, tableData);
        }

        case "ctx": {
            const commands = Array.from(client.commands.context.commands.values());
            commands.sort((a, b) => a.builder.name.localeCompare(b.builder.name));

            const tableData: Record<string, string> = {};
            for (const cmd of commands) {
                // Context menus don't have descriptions, but they do have types (User/Message)
                const type = cmd.builder.type === 2 ? "User" : "Msg";
                tableData[`[${type}] ${cmd.builder.name}`] = "";
            }

            return CLI.logger.table(`(cmds) ~ ctx (${$.format.number(commands.length)})`, tableData);
        }

        default:
            return CLI.logger.error(`'${mode}' is not a valid option. Valid options: [slash|prefix|ctx]`);
    }
});
