import type { CLICommand } from "../types.js";

import { collectClientHealth } from "../health.js";
import { getCLIFlagValues, hasCLIFlag } from "../parser.js";
import { formatBytes, formatDuration, formatLatency, requireCLIClient, resolveCLIGuild, resolveCLIUser } from "./helpers.js";

function healthStatus(status: "healthy" | "degraded" | "unavailable"): string {
    switch (status) {
        case "healthy":
            return "Healthy";
        case "degraded":
            return "Degraded";
        case "unavailable":
            return "Unavailable";
    }
}

export function createInfoCLICommands(): CLICommand[] {
    return [
        {
            name: "ping",
            description: "Displays Discord latency and plugin-provided service health.",
            usage: "/ping [--json]",
            execute: async context => {
                const client = requireCLIClient(context);
                const probes = client.plugins.getHealthProbes();
                const loader = probes.length ? context.logger.commandLoader("Checking service health", client) : null;
                const health = await collectClientHealth(client, context.signal);
                loader?.stop();

                const data = {
                    discord: {
                        status: client.isReady() ? "healthy" : "unavailable",
                        latencyMs: client.ws.ping >= 0 ? client.ws.ping : null,
                        detail: client.isReady() ? "Gateway ready" : "Client not ready"
                    },
                    services: health.map(({ pluginName, probe, result }) => ({
                        id: probe.id,
                        label: probe.label,
                        plugin: pluginName,
                        ...result
                    }))
                };

                context.logger.header("Ping", client);
                if (hasCLIFlag(context.flags, "json")) {
                    context.logger.json(data);
                    return;
                }

                context.logger.table(
                    [
                        { key: "service", label: "Service" },
                        { key: "status", label: "Status" },
                        { key: "latency", label: "Latency", align: "right" },
                        { key: "detail", label: "Detail" }
                    ],
                    [
                        {
                            service: "Discord Gateway",
                            status: client.isReady() ? "Healthy" : "Unavailable",
                            latency: client.ws.ping >= 0 ? formatLatency(client.ws.ping) : "—",
                            detail: data.discord.detail
                        },
                        ...health.map(({ probe, result }) => ({
                            service: probe.label,
                            status: healthStatus(result.status),
                            latency: formatLatency(result.latencyMs),
                            detail: result.detail ?? ""
                        }))
                    ]
                );
            }
        },
        {
            name: "stats",
            description: "Displays client, process, module, cache, and service statistics.",
            usage: "/stats [--json]",
            execute: async context => {
                const client = requireCLIClient(context);
                const loader = client.plugins.getHealthProbes().length
                    ? context.logger.commandLoader("Collecting client statistics", client)
                    : null;
                const health = await collectClientHealth(client, context.signal);
                const memory = process.memoryUsage();
                const data = {
                    client: {
                        application: client.$name,
                        applicationVersion: client.$version,
                        discordUser: client.user?.tag ?? null,
                        discordUserId: client.user?.id ?? null,
                        ready: client.isReady(),
                        environment: client.$devMode ? "development" : "production",
                        uptimeMs: client.uptime,
                        gatewayLatencyMs: client.ws.ping >= 0 ? client.ws.ping : null,
                        shardCount: client.ws.shards.size
                    },
                    cache: {
                        guilds: client.guilds.cache.size,
                        users: client.users.cache.size,
                        channels: client.channels.cache.size
                    },
                    modules: {
                        events: client.modules.events.getAll().length,
                        slash: client.modules.commands.slash.getAll().length,
                        prefix: client.modules.commands.prefix.getAll().length,
                        context: client.modules.commands.getAllContextCommands().length,
                        plugins: client.plugins.getAll(true).length
                    },
                    process: {
                        pid: process.pid,
                        uptimeMs: process.uptime() * 1_000,
                        node: process.version,
                        platform: process.platform,
                        architecture: process.arch,
                        memory
                    },
                    services: health.map(({ pluginName, probe, result }) => ({
                        id: probe.id,
                        label: probe.label,
                        plugin: pluginName,
                        ...result
                    }))
                };
                loader?.stop();

                context.logger.header("Stats", client);
                if (hasCLIFlag(context.flags, "json")) {
                    context.logger.json(data);
                    return;
                }

                context.logger.group("Client", [
                    `Application   ${data.client.application} v${data.client.applicationVersion}`,
                    `Discord       ${data.client.discordUser ?? "Not logged in"}${data.client.discordUserId ? ` (${data.client.discordUserId})` : ""}`,
                    `State         ${data.client.ready ? "Ready" : "Not ready"}`,
                    `Environment   ${data.client.environment}`,
                    `Uptime        ${formatDuration(data.client.uptimeMs)}`,
                    `Gateway       ${data.client.gatewayLatencyMs === null ? "—" : formatLatency(data.client.gatewayLatencyMs)}`,
                    `Shards        ${data.client.shardCount}`
                ]);
                context.logger.group("Caches and modules", [
                    `Guilds        ${data.cache.guilds}`,
                    `Users         ${data.cache.users}`,
                    `Channels      ${data.cache.channels}`,
                    `Events        ${data.modules.events}`,
                    `Commands      ${data.modules.slash} slash · ${data.modules.prefix} prefix · ${data.modules.context} context`,
                    `Plugins       ${data.modules.plugins}`
                ]);
                context.logger.group("Process", [
                    `PID           ${data.process.pid}`,
                    `Uptime        ${formatDuration(data.process.uptimeMs)}`,
                    `Runtime       ${data.process.node} · ${data.process.platform}/${data.process.architecture}`,
                    `RSS           ${formatBytes(memory.rss)}`,
                    `Heap          ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
                    `External      ${formatBytes(memory.external)}`
                ]);
                if (health.length) {
                    context.logger.group(
                        "Services",
                        health.map(
                            ({ probe, result }) =>
                                `${probe.label.padEnd(13)} ${healthStatus(result.status)}${result.latencyMs === undefined ? "" : ` · ${formatLatency(result.latencyMs)}`}${result.detail ? ` · ${result.detail}` : ""}`
                        )
                    );
                }
            }
        },
        {
            name: "guildinfo",
            description: "Fetches information about a guild available to the attached client.",
            usage: "/guildinfo <id|name> [--json]",
            execute: async context => {
                const client = requireCLIClient(context);
                const query = context.args.join(" ");
                if (!query) throw new Error("Usage: /guildinfo <id|name>");

                const loader = context.logger.commandLoader("Fetching guild information", client);
                try {
                    const guild = await resolveCLIGuild(client, query);
                    const data = {
                        id: guild.id,
                        name: guild.name,
                        ownerId: guild.ownerId,
                        createdAt: guild.createdAt.toISOString(),
                        botJoinedAt: guild.members.me?.joinedAt?.toISOString() ?? null,
                        members: guild.memberCount,
                        channels: guild.channels.cache.size,
                        roles: guild.roles.cache.size,
                        boosts: guild.premiumSubscriptionCount ?? 0,
                        boostTier: String(guild.premiumTier),
                        verificationLevel: String(guild.verificationLevel),
                        shardId: guild.shardId,
                        features: guild.features
                    };
                    loader.stop();

                    context.logger.header("Guild Info", client);
                    if (hasCLIFlag(context.flags, "json")) context.logger.json(data);
                    else {
                        context.logger.fields([
                            ["Name", data.name],
                            ["ID", data.id],
                            ["Owner", data.ownerId],
                            ["Created", data.createdAt],
                            ["Bot joined", data.botJoinedAt ?? "Unknown"],
                            ["Members", data.members],
                            ["Channels", data.channels],
                            ["Roles", data.roles],
                            ["Boosts", `${data.boosts} (tier ${data.boostTier})`],
                            ["Verification", data.verificationLevel],
                            ["Shard", data.shardId],
                            ["Features", data.features.join(", ") || "None"]
                        ]);
                    }
                } catch (error) {
                    loader.fail("Failed to fetch guild information", error);
                }
            }
        },
        {
            name: "userinfo",
            description: "Fetches Discord user and optional guild-member information.",
            usage: "/userinfo <id|username> [--guild <id|name>] [--json]",
            execute: async context => {
                const client = requireCLIClient(context);
                const query = context.args.join(" ");
                if (!query) throw new Error("Usage: /userinfo <id|username> [--guild <id|name>]");

                const loader = context.logger.commandLoader("Fetching user information", client);
                try {
                    const user = await resolveCLIUser(client, query);
                    const guildValues = getCLIFlagValues(context.flags, "guild");
                    if (hasCLIFlag(context.flags, "guild") && !guildValues.length) {
                        throw new Error("--guild requires a guild id or name");
                    }
                    const guildQuery = guildValues.join(" ");
                    const guild = guildQuery ? await resolveCLIGuild(client, guildQuery) : null;
                    const [member, botStaff] = await Promise.all([
                        guild ? guild.members.fetch(user.id).catch(() => null) : null,
                        client.isBotStaff(user.id)
                    ]);
                    const roles = member
                        ? member.roles.cache
                              .filter(role => role.id !== guild?.id)
                              .map(role => ({ id: role.id, name: role.name }))
                        : [];
                    const data = {
                        id: user.id,
                        username: user.username,
                        globalName: user.globalName,
                        tag: user.tag,
                        bot: user.bot,
                        system: user.system,
                        botStaff,
                        createdAt: user.createdAt.toISOString(),
                        avatarUrl: user.displayAvatarURL({ size: 1024 }),
                        member: member
                            ? {
                                  guildId: member.guild.id,
                                  guildName: member.guild.name,
                                  nickname: member.nickname,
                                  joinedAt: member.joinedAt?.toISOString() ?? null,
                                  boostingSince: member.premiumSince?.toISOString() ?? null,
                                  timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
                                  presence: member.presence?.status ?? null,
                                  roles
                              }
                            : null
                    };
                    loader.stop();

                    context.logger.header("User Info", client);
                    if (hasCLIFlag(context.flags, "json")) context.logger.json(data);
                    else {
                        context.logger.fields([
                            ["Username", data.tag],
                            ["Global name", data.globalName ?? "None"],
                            ["ID", data.id],
                            ["Account type", data.bot ? "Bot" : data.system ? "System" : "User"],
                            ["Bot staff", data.botStaff ? "Yes" : "No"],
                            ["Created", data.createdAt],
                            ["Avatar", data.avatarUrl]
                        ]);
                        if (data.member) {
                            context.logger.group("Guild member", [
                                `Guild          ${data.member.guildName} (${data.member.guildId})`,
                                `Nickname       ${data.member.nickname ?? "None"}`,
                                `Joined         ${data.member.joinedAt ?? "Unknown"}`,
                                `Boosting       ${data.member.boostingSince ?? "No"}`,
                                `Timeout        ${data.member.timeoutUntil ?? "None"}`,
                                `Presence       ${data.member.presence ?? "Unavailable"}`,
                                `Roles          ${data.member.roles.map(role => role.name).join(", ") || "None"}`
                            ]);
                        }
                    }
                } catch (error) {
                    loader.fail("Failed to fetch user information", error);
                }
            }
        }
    ];
}
