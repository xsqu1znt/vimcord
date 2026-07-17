import type { CLICommand } from "../types.js";

import { formatCLIClientTarget } from "../CLILogger.js";
import { hasCLIFlag } from "../parser.js";
import { formatLatency, requireCLIClient } from "./helpers.js";

export function createGeneralCLICommands(): CLICommand[] {
    return [
        {
            name: "help",
            description: "Lists available CLI commands or explains one command.",
            usage: "/help [command]",
            requiresClient: false,
            execute: ({ cli, logger, client, args }) => {
                const commands = cli.getAvailableCommands(client);
                const requested = args[0]?.replace(/^\//, "").toLowerCase();
                if (requested) {
                    const command = commands.find(
                        candidate => candidate.name === requested || candidate.aliases?.includes(requested) === true
                    );
                    if (!command) throw new Error(`No CLI command named '/${requested}' is available`);

                    logger.header(`Help: /${command.name}`, client);
                    logger.fields([
                        ["Usage", command.usage ?? `/${command.name}`],
                        ["Description", command.description],
                        ["Aliases", command.aliases?.map(alias => `/${alias}`).join(", ") || "None"]
                    ]);
                    return;
                }

                logger.header("Help", client);
                logger.table(
                    [
                        { key: "command", label: "Command" },
                        { key: "usage", label: "Usage" },
                        { key: "description", label: "Description" }
                    ],
                    commands
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(command => ({
                            command: `/${command.name}`,
                            usage: command.usage ?? `/${command.name}`,
                            description: command.description
                        }))
                );
            }
        },
        {
            name: "clients",
            description: "Lists clients participating in this CLI.",
            requiresClient: false,
            supportsAllClients: false,
            execute: ({ cli, logger, client, flags }) => {
                const clients = cli.getClients();
                const selected = cli.getSelectedClient();
                const data = clients.map(client => ({
                    selected: client === selected,
                    id: client.id,
                    identity: client.user?.tag ?? client.$name,
                    state: client.isReady() ? "Ready" : "Not ready",
                    ping: client.ws.ping >= 0 ? client.ws.ping : null
                }));

                logger.header("Clients", client);
                if (hasCLIFlag(flags, "json")) {
                    logger.json(data);
                    return;
                }
                logger.table(
                    [
                        { key: "selected", label: "" },
                        { key: "id", label: "Client" },
                        { key: "identity", label: "Identity" },
                        { key: "state", label: "State" },
                        { key: "ping", label: "Ping", align: "right" }
                    ],
                    data.map(client => ({
                        ...client,
                        selected: client.selected ? "●" : "○",
                        ping: client.ping === null ? "—" : formatLatency(client.ping)
                    }))
                );
            }
        },
        {
            name: "use",
            description: "Changes the active client used by subsequent commands.",
            usage: "/use <client>",
            requiresClient: false,
            execute: ({ cli, logger, args }) => {
                const query = args.join(" ");
                if (!query) throw new Error("Usage: /use <client>");

                const client = cli.selectClient(query);
                logger.header("Client Selected", client);
                logger.line(`Active client: ${logger.styles.target(formatCLIClientTarget(client))}`);
            }
        },
        {
            name: "version",
            description: "Displays application and runtime version information.",
            requiresClient: false,
            execute: ({ logger, client, flags }) => {
                const data = {
                    clientId: client?.id ?? null,
                    application: client?.$name ?? null,
                    applicationVersion: client?.$version ?? null,
                    node: process.version
                };

                logger.header("Version", client);
                if (hasCLIFlag(flags, "json")) logger.json(data);
                else {
                    logger.fields([
                        ["Application", data.application ?? "No client selected"],
                        ["App version", data.applicationVersion ?? "—"],
                        ["Node", data.node]
                    ]);
                }
            }
        },
        {
            name: "plugins",
            description: "Lists plugins registered on the selected client.",
            usage: "/plugins [--json]",
            execute: context => {
                const client = requireCLIClient(context);
                const plugins = client.plugins.getAll().map(plugin => ({
                    name: plugin.name,
                    version: plugin.version,
                    status: plugin.installed ? "Installed" : "Registered",
                    description: plugin.description
                }));

                context.logger.header("Plugins", client);
                if (hasCLIFlag(context.flags, "json")) context.logger.json(plugins);
                else {
                    context.logger.table(
                        [
                            { key: "name", label: "Plugin" },
                            { key: "version", label: "Version" },
                            { key: "status", label: "Status" },
                            { key: "description", label: "Description" }
                        ],
                        plugins
                    );
                }
            }
        },
        {
            name: "modules",
            description: "Displays loaded command and event module counts.",
            usage: "/modules [--json]",
            execute: context => {
                const client = requireCLIClient(context);
                const data = {
                    events: client.modules.events.getAll().length,
                    slashCommands: client.modules.commands.slash.getAll().length,
                    prefixCommands: client.modules.commands.prefix.getAll().length,
                    messageContextCommands: client.modules.commands.context.message.getAll().length,
                    userContextCommands: client.modules.commands.context.user.getAll().length
                };

                context.logger.header("Modules", client);
                if (hasCLIFlag(context.flags, "json")) context.logger.json(data);
                else {
                    context.logger.fields([
                        ["Events", data.events],
                        ["Slash commands", data.slashCommands],
                        ["Prefix commands", data.prefixCommands],
                        ["Message context", data.messageContextCommands],
                        ["User context", data.userContextCommands]
                    ]);
                }
            }
        },
        {
            name: "clear",
            description: "Clears consoles that support ANSI terminal control.",
            requiresClient: false,
            execute: ({ logger }) => logger.clear()
        },
        {
            name: "exit",
            description: "Destroys participating clients and stops the CLI.",
            usage: "/exit --confirm",
            requiresClient: false,
            execute: async ({ cli, logger, flags }) => {
                const clients = cli.getClients();
                if (hasCLIFlag(flags, "client")) throw new Error("/exit always applies to every participating client");
                const unknownFlags = Array.from(flags.keys()).filter(flag => flag !== "confirm");
                if (unknownFlags.length) {
                    throw new Error(
                        `Unknown flag${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map(flag => `--${flag}`).join(", ")}`
                    );
                }
                if ((flags.get("confirm") ?? []).length) throw new Error("--confirm does not accept a value");
                if (!hasCLIFlag(flags, "confirm")) {
                    logger.header("Exit", cli.getSelectedClient());
                    logger.line(
                        `This will destroy ${clients.length} participating client${clients.length === 1 ? "" : "s"}.`
                    );
                    logger.line(`Run ${logger.styles.command("/exit --confirm")} to continue.`);
                    return;
                }

                const loader = logger.commandLoader("Stopping Vimcord clients");
                try {
                    await Promise.all(clients.map(client => client.destroy()));
                    loader.succeed("Stopped Vimcord clients");
                    cli.stop();
                } catch (error) {
                    loader.fail("Failed to stop Vimcord clients", error);
                }
            }
        }
    ];
}
