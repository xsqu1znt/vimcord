import type { CLICommand } from "../types.js";

import { getVimcordPackageVersion } from "@/utils/packageVersion.js";
import { hasCLIFlag } from "../parser.js";
import { requireCLIClient } from "./helpers.js";

export function createGeneralCLICommands(): CLICommand[] {
    return [
        {
            name: "help",
            description: "Lists available CLI commands or explains one command.",
            usage: "/help [command]",
            requiresClient: false,
            execute: ({ cli, logger, client, args }) => {
                const commands = cli.getAvailableCommands();
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
            name: "version",
            description: "Displays application and runtime version information.",
            requiresClient: false,
            execute: ({ logger, client, flags }) => {
                const data = {
                    application: client?.$name ?? null,
                    applicationVersion: client?.$version ? `v${client.$version}` : null,
                    vimcordVersion: `v${getVimcordPackageVersion()}`,
                    node: process.version
                };

                logger.header("Version", client);
                if (hasCLIFlag(flags, "json")) logger.json(data);
                else {
                    logger.fields([
                        ["Application", data.application ?? "No client attached"],
                        ["App version", data.applicationVersion ? `v${data.applicationVersion}` : "—"],
                        ["Vimcord", `v${data.vimcordVersion}`],
                        ["Node", data.node]
                    ]);
                }
            }
        },
        {
            name: "plugins",
            description: "Lists plugins registered on the attached client.",
            usage: "/plugins [--json]",
            execute: context => {
                const client = requireCLIClient(context);
                const plugins = client.plugins.getAll().map(plugin => ({
                    name: plugin.name,
                    version: plugin.version,
                    status: client.plugins.isInstalled(plugin.name) ? "Installed" : "Registered",
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
            description: "Destroys the attached client and stops the CLI.",
            usage: "/exit --confirm",
            requiresClient: false,
            execute: async ({ cli, logger, flags }) => {
                const client = cli.getClient();
                const unknownFlags = Array.from(flags.keys()).filter(flag => flag !== "confirm");
                if (unknownFlags.length) {
                    throw new Error(
                        `Unknown flag${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.map(flag => `--${flag}`).join(", ")}`
                    );
                }
                if ((flags.get("confirm") ?? []).length) throw new Error("--confirm does not accept a value");
                if (!hasCLIFlag(flags, "confirm")) {
                    logger.header("Exit", client);
                    logger.line(client ? "This will destroy the attached client." : "This will stop the CLI.");
                    logger.line(`Run ${logger.styles.command("/exit --confirm")} to continue.`);
                    return;
                }

                const loader = logger.commandLoader(client ? "Stopping Vimcord client" : "Stopping CLI", client);
                try {
                    if (client) await client.destroy();
                    loader.succeed(client ? "Stopped Vimcord client" : "Stopped CLI");
                    cli.stop();
                } catch (error) {
                    loader.fail(client ? "Failed to stop Vimcord client" : "Failed to stop CLI", error);
                }
            }
        }
    ];
}
