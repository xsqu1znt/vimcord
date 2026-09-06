import type { CommandFilter } from "@/client/managers/BaseCommandManager.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CLICommand, CLICommandContext } from "../types.js";

import { getCLIFlagValues, hasCLIFlag } from "../parser.js";
import { requireCLIClient, resolveCLIGuild } from "./helpers.js";

function rejectUnknownFlags(context: CLICommandContext, allowed: readonly string[]): void {
    const unknown = Array.from(context.flags.keys()).filter(flag => !allowed.includes(flag));
    if (unknown.length)
        throw new Error(`Unknown flag${unknown.length === 1 ? "" : "s"}: ${unknown.map(flag => `--${flag}`).join(", ")}`);
}

function readCommandFilter(context: CLICommandContext): CommandFilter {
    const names = getCLIFlagValues(context.flags, "names").flatMap(value =>
        value
            .split(",")
            .map(name => name.trim())
            .filter(Boolean)
    );
    const categories = getCLIFlagValues(context.flags, "category");
    const tags = getCLIFlagValues(context.flags, "tag");
    if (hasCLIFlag(context.flags, "names") && !names.length) throw new Error("--names requires at least one command name");
    if (hasCLIFlag(context.flags, "category") && !categories.length) throw new Error("--category requires one value");
    if (hasCLIFlag(context.flags, "tag") && !tags.length) throw new Error("--tag requires one value");
    if (categories.length > 1) throw new Error("--category accepts one value");
    if (tags.length > 1) throw new Error("--tag accepts one value");

    return {
        names: names.length ? names : undefined,
        category: categories[0],
        tag: tags[0]
    };
}

async function resolveGuildIds(client: Vimcord, values: readonly string[]): Promise<string[]> {
    if (!values.length) throw new Error("Specify one or more guilds, or use the explicit 'all' target");

    const requestsAll = values.some(value => value.toLowerCase() === "all");
    if (requestsAll) {
        if (values.length > 1) throw new Error("The 'all' guild target cannot be combined with other guilds");
        const guildIds = client.guilds.cache.map(guild => guild.id);
        if (!guildIds.length) throw new Error("The attached client has no cached guilds");
        return guildIds;
    }

    const guilds = await Promise.all(values.map(value => resolveCLIGuild(client, value)));
    return Array.from(new Set(guilds.map(guild => guild.id)));
}

function readScope(context: CLICommandContext, commandName: "register" | "unregister"): "global" | "guild" {
    const scope = context.args[0]?.toLowerCase();
    if (scope !== "global" && scope !== "guild") {
        throw new Error(`Usage: /${commandName} <global|guild>`);
    }
    return scope;
}

function createRegisterCommand(): CLICommand {
    return {
        name: "register",
        description: "Pushes loaded application commands globally or to explicit guild targets.",
        usage: "/register <global|guild> [guilds...|all] [--names ...] [--category ...] [--tag ...]",
        execute: async context => {
            rejectUnknownFlags(context, ["names", "category", "tag"]);
            const client = requireCLIClient(context);
            const scope = readScope(context, "register");
            const filter = readCommandFilter(context);
            const manager = client.modules.commands;

            if (scope === "global") {
                if (context.args.length > 1) throw new Error("Global registration does not accept guild targets");
                const commandCount = manager
                    .getAllAppCommands(filter)
                    .filter(command => command.registration.global !== false).length;
                if (!commandCount) throw new Error("No matching globally enabled application commands are loaded");

                const loader = context.logger.commandLoader("Registering global application commands", client);
                try {
                    const succeeded = await manager.push(filter);
                    if (!succeeded) {
                        loader.fail("Global application command registration did not complete");
                        return;
                    }
                    loader.succeed(`Registered ${commandCount} global application command${commandCount === 1 ? "" : "s"}`);
                } catch (error) {
                    loader.fail("Failed to register global application commands", error);
                }
                return;
            }

            const guildIds = await resolveGuildIds(client, context.args.slice(1));
            const commandCount = manager.getAllAppCommands(filter).length;
            if (!commandCount) throw new Error("No matching application commands are loaded");

            const loader = context.logger.commandLoader(
                `Registering ${commandCount} application command${commandCount === 1 ? "" : "s"} in ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`,
                client
            );
            try {
                const succeeded = await manager.pushByGuild({ ...filter, guilds: guildIds });
                if (!succeeded) {
                    loader.fail("Guild application command registration did not complete");
                    return;
                }
                loader.succeed(
                    `Registered ${commandCount} application command${commandCount === 1 ? "" : "s"} in ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`
                );
            } catch (error) {
                loader.fail("Failed to register guild application commands", error);
            }
        }
    };
}

function createUnregisterCommand(): CLICommand {
    return {
        name: "unregister",
        description: "Removes every remote application command from a global or guild scope.",
        usage: "/unregister <global|guild> [guilds...|all] --confirm",
        execute: async context => {
            rejectUnknownFlags(context, ["confirm"]);
            if (getCLIFlagValues(context.flags, "confirm").length) {
                throw new Error("--confirm does not accept a value");
            }
            const client = requireCLIClient(context);
            const scope = readScope(context, "unregister");
            if (
                hasCLIFlag(context.flags, "names") ||
                hasCLIFlag(context.flags, "category") ||
                hasCLIFlag(context.flags, "tag")
            ) {
                throw new Error("Selective unregistering is not supported; the selected remote scope is cleared completely");
            }

            const guildIds = scope === "guild" ? await resolveGuildIds(client, context.args.slice(1)) : [];
            if (scope === "global" && context.args.length > 1) {
                throw new Error("Global unregistering does not accept guild targets");
            }

            if (!hasCLIFlag(context.flags, "confirm")) {
                context.logger.header("Unregister Application Commands", client);
                const target =
                    scope === "global"
                        ? "the global application-command scope"
                        : `${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`;
                context.logger.line(`This will remove every remote application command from ${target}.`);
                const confirmedTarget = scope === "global" ? "global" : `guild ${guildIds.join(" ")}`;
                context.logger.line(
                    `Run ${context.logger.styles.command(`/unregister ${confirmedTarget} --confirm`)} to continue.`
                );
                return;
            }

            const action =
                scope === "global"
                    ? "Unregistering global application commands"
                    : `Unregistering application commands from ${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}`;
            const loader = context.logger.commandLoader(action, client);
            try {
                const succeeded =
                    scope === "global"
                        ? await client.modules.commands.pull()
                        : await client.modules.commands.pullByGuild({ guilds: guildIds });
                if (!succeeded) {
                    loader.fail("Application command removal did not complete");
                    return;
                }
                loader.succeed(action.replace("Unregistering", "Unregistered"));
            } catch (error) {
                loader.fail("Failed to unregister application commands", error);
            }
        }
    };
}

export function createRegistrationCLICommands(): CLICommand[] {
    return [createRegisterCommand(), createUnregisterCommand()];
}
