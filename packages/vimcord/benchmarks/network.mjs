import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { GatewayIntentBits, PermissionFlagsBits, Routes, SlashCommandBuilder } from "discord.js";
import * as current from "../dist/index.js";

const OPTIONS = {
    samples: Number(process.env.VIMCORD_BENCH_SAMPLES ?? 8),
    intervalMs: 2_200,
    interactiveMs: Number(process.env.VIMCORD_BENCH_INTERACTIVE_MS ?? 0),
    commandName: "vimcord-net",
    apps: ["utility", "economy", "moderation", "support", "bookmarks"],
    mentions: { parse: [], repliedUser: false }
};

function summary(values) {
    const sorted = values.toSorted((a, b) => a - b);
    return {
        samples: sorted.length,
        p50: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
    };
}

// Read the credential only inside this process; output never includes Discord objects, headers, or raw errors.
async function main() {
    assert.ok(process.env.VIMCORD_BENCH_TOKEN_FILE, "Set VIMCORD_BENCH_TOKEN_FILE");
    const token = (await readFile(process.env.VIMCORD_BENCH_TOKEN_FILE, "utf8")).trim();
    const guildId = process.env.VIMCORD_BENCH_GUILD_ID;
    const channelId = process.env.VIMCORD_BENCH_CHANNEL_ID;
    assert.match(guildId ?? "", /^\d+$/);
    assert.match(channelId ?? "", /^\d+$/);
    const baselinePath = process.env.VIMCORD_BENCH_BASELINE;
    assert.ok(baselinePath, "Set VIMCORD_BENCH_BASELINE to the preserved pre-change bundle");
    const baseline = await import(pathToFileURL(baselinePath).href);
    const hashes = {
        baselineHash: createHash("sha256")
            .update(await readFile(baselinePath))
            .digest("hex"),
        currentHash: createHash("sha256")
            .update(await readFile(new URL("../dist/index.js", import.meta.url)))
            .digest("hex")
    };
    const require = createRequire(import.meta.url);
    const restRequire = createRequire(require.resolve("@discordjs/rest", { paths: [require.resolve("discord.js")] }));
    const { DefaultRestOptions } = restRequire("@discordjs/rest");
    const libraries = { baseline, current };
    const rows = [];
    const owned = new Set();
    const paginators = [];
    const paginationVariants = new Map();
    const pending = new Map();
    const balances = new Map();
    const warnings = new Map();
    const saved = new Set();
    let active;
    let navigationTimer;
    let temporaryCommand;
    let seed;
    let channel;
    let stopping = false;
    const client = new current.Vimcord({
        client: {
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
            allowedMentions: OPTIONS.mentions,
            rest: {
                async makeRequest(url, init) {
                    const record = active;
                    const started = performance.now();
                    const response = await DefaultRestOptions.makeRequest(url, init);
                    record?.requests.push({
                        method: init.method,
                        ms: performance.now() - started,
                        bytes: typeof init.body === "string" ? Buffer.byteLength(init.body) : null,
                        status: response.status
                    });
                    return response;
                }
            }
        },
        globals: { app: { disableBanner: true, enableCLI: false, commandLogging: ["execute"] } }
    });
    // Keep usage formatting enabled, but do not print user, server, or channel identities.
    client.logger.write = () => {};
    client.rest.on("rateLimited", () => {
        if (active) active.rateLimited = true;
    });
    client.on("error", () => console.log(JSON.stringify({ event: "client-error" })));
    const managers = { baseline: new baseline.CommandManager(client), current: client.modules.commands };

    function finish(record) {
        clearTimeout(navigationTimer);
        record.ms = performance.now() - record.started;
        delete record.started;
        rows.push(record);
        active = undefined;
        console.log(JSON.stringify(record));
    }

    function remember(response) {
        const message = response?.resource?.message ?? response;
        if (message?.id && message.author?.id === client.user.id) owned.add(message.id);
        return message;
    }

    async function execute(app, source, library, key, interaction) {
        const reply = async data => {
            const response = await source.reply({ ...data, allowedMentions: OPTIONS.mentions, withResponse: interaction });
            const message = remember(response);
            assert.equal(message?.content, data.content);
            return response;
        };
        let result;
        if (app === "utility") result = await reply({ content: "Online and ready" });
        else if (app === "economy") {
            const amount = interaction ? (source.options.getInteger("amount") ?? 5) : Number(source.content.split(/\s+/)[2]);
            if (!Number.isSafeInteger(amount) || amount <= 0) return reply({ content: "Enter a positive whole amount" });
            const balance = (balances.get(key) ?? 0) + amount;
            balances.set(key, balance);
            result = await reply({ content: `Balance: ${balance}` });
        } else if (app === "moderation") {
            const count = (warnings.get(key) ?? 0) + 1;
            warnings.set(key, count);
            result = await reply({ content: `Benchmark warning ${count}: Please review the rules (test only)` });
        } else if (app === "support") {
            result = await new library.BetterEmbed({
                title: "Support ticket",
                description: ["Tell us what happened.", "A moderator will reply here."],
                color: 0x5865f2
            }).send(source, { allowedMentions: OPTIONS.mentions, withResponse: interaction });
            remember(result);
            assert.equal(result?.embeds[0]?.title, "Support ticket");
        } else if (app === "bookmarks") {
            saved.add(seed.id);
            result = await reply({ content: `Saved benchmark resource: ${seed.url}` });
        } else if (app === "pagination") {
            const paginator = new library.Paginator({
                pages: ["Benchmark page A", "Benchmark page B", "Benchmark page C"],
                timeout: 600_000,
                onResolve: library.ResolveAction.DoNothing
            });
            paginators.push(paginator);
            paginator.on("paginate", () => {
                if (active?.flow === "component") finish(active);
            });
            result = await paginator.send(source, { allowedMentions: OPTIONS.mentions });
            if (result?.id) paginationVariants.set(result.id, key.split(":")[0]);
        }
        remember(result);
        return result;
    }

    const builder = new SlashCommandBuilder()
        .setName(OPTIONS.commandName)
        .setDescription("Temporary Vimcord network benchmark; only in the configured dev channel")
        .addStringOption(o =>
            o
                .setName("app")
                .setDescription("Bot flow")
                .setRequired(true)
                .addChoices(...[...OPTIONS.apps, "pagination"].map(name => ({ name, value: name })))
        )
        .addStringOption(o =>
            o
                .setName("variant")
                .setDescription("Comparison build")
                .setRequired(true)
                .addChoices(...["baseline", "current", "control"].map(name => ({ name, value: name })))
        )
        .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit (economy only)").setMinValue(1));

    for (const [variant, manager] of Object.entries(managers)) {
        const library = libraries[variant];
        for (const app of OPTIONS.apps) {
            manager.prefix.register(
                new library.PrefixCommandModule({
                    name: app,
                    permissions: { allowBots: true, users: [] },
                    ...(app === "moderation"
                        ? { conditions: [ctx => ({ passed: ctx.message.channelId === channelId })] }
                        : {}),
                    ...(app === "economy"
                        ? {
                              aliases: ["wallet"],
                              subcommands: {
                                  deposit: {
                                      handler: ({ message }) =>
                                          execute(app, message, library, `${variant}:prefix:${app}`, false)
                                  }
                              }
                          }
                        : {
                              execute: ({ message }) => execute(app, message, library, `${variant}:prefix:${app}`, false)
                          })
                })
            );
        }
        manager.slash.register(
            new library.SlashCommandModule({
                builder,
                execute: ({ interaction }) =>
                    execute(
                        interaction.options.getString("app", true),
                        interaction,
                        library,
                        `${variant}:slash:${interaction.options.getString("app", true)}`,
                        true
                    )
            })
        );
    }

    client.on("messageCreate", message => {
        if (message.channelId !== channelId || message.author.id !== client.user.id) return;
        const request = pending.get(message.content);
        if (!request) return;
        pending.delete(message.content);
        owned.add(message.id);
        request.record.gatewayMs = performance.now() - request.sent;
        request.record.started = performance.now();
        active = request.record;
        const operation =
            request.record.variant === "control"
                ? execute(request.record.app, message, current, `control:prefix:${request.record.app}`, false)
                : managers[request.record.variant].dispatchMessage(message, ["!vcnet-"]);
        Promise.resolve(operation).then(
            () => {
                finish(request.record);
                request.resolve();
            },
            error => {
                request.record.failed = true;
                finish(request.record);
                request.reject(error);
            }
        );
    });
    client.on("interactionCreate", interaction => {
        if (interaction.isMessageComponent() && paginationVariants.has(interaction.message.id)) {
            if (active) {
                active.overlapped = true;
                return;
            }
            active = {
                app: "pagination",
                variant: paginationVariants.get(interaction.message.id),
                flow: "component",
                started: performance.now(),
                requests: [],
                rateLimited: false
            };
            navigationTimer = setTimeout(() => {
                if (active?.flow !== "component") return;
                active.incomplete = true;
                finish(active);
            }, 20_000);
            return;
        }
        if (!interaction.isChatInputCommand() || interaction.commandName !== OPTIONS.commandName) return;
        if (interaction.channelId !== channelId) return;
        if (active) {
            active.overlapped = true;
            void interaction.reply({ content: "Benchmark is busy; retry shortly", flags: "Ephemeral" }).catch(() => {});
            return;
        }
        const variant = interaction.options.getString("variant", true);
        const app = interaction.options.getString("app", true);
        const record = { app, variant, flow: "slash", started: performance.now(), requests: [], rateLimited: false };
        active = record;
        const operation =
            variant === "control"
                ? execute(app, interaction, current, `control:slash:${app}`, true)
                : managers[variant].dispatchInteraction(interaction);
        Promise.resolve(operation).then(
            () => finish(record),
            () => {
                active = undefined;
                console.log(JSON.stringify({ event: "interaction-error", app, variant }));
            }
        );
    });

    const stop = () => {
        stopping = true;
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        const ready = once(client, "clientReady");
        await client.login(token);
        await ready;
        channel = await client.channels.fetch(channelId);
        assert.equal(channel.guildId, guildId);
        assert.ok(
            channel.permissionsFor(client.user).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
        );
        seed = await channel.send({
            content: "Vimcord live benchmark resource (temporary)",
            allowedMentions: OPTIONS.mentions
        });
        owned.add(seed.id);
        if (OPTIONS.interactiveMs) {
            const route = Routes.applicationGuildCommands(client.user.id, guildId);
            const existing = await client.rest.get(route);
            assert.ok(!existing.some(c => c.name === OPTIONS.commandName), "Temporary command name already exists");
            temporaryCommand = await client.rest.post(route, { body: builder.toJSON() });
            console.log(
                JSON.stringify({ event: "slash-ready", command: OPTIONS.commandName, apps: [...OPTIONS.apps, "pagination"] })
            );
            const until = Date.now() + OPTIONS.interactiveMs;
            while (!stopping && Date.now() < until) await new Promise(r => setTimeout(r, 250));
            while (active) await new Promise(r => setTimeout(r, 250));
        }
        // A paired rotation avoids giving one build every cold request or every late rate-limit window.
        for (let sample = -1; OPTIONS.samples > 0 && sample < OPTIONS.samples && !stopping; sample++) {
            for (const app of OPTIONS.apps) {
                for (let offset = 0; offset < 3; offset++) {
                    const variant = ["baseline", "current", "control"][(sample + 1 + offset) % 3];
                    await new Promise(r => setTimeout(r, OPTIONS.intervalMs));
                    const content = `!vcnet-${app}${app === "economy" ? " deposit 5" : ""} ${randomUUID()}`;
                    const record = { app, variant, flow: "prefix", warmup: sample < 0, requests: [], rateLimited: false };
                    let timer;
                    const done = new Promise((resolve, reject) => {
                        timer = setTimeout(() => reject(new Error("Gateway command timed out")), 20_000);
                        pending.set(content, { record, sent: performance.now(), resolve, reject });
                    });
                    try {
                        const command = await channel.send({ content, allowedMentions: OPTIONS.mentions });
                        owned.add(command.id);
                        await done;
                        assert.equal(record.requests.length, 1, "One reply request is expected");
                    } finally {
                        clearTimeout(timer);
                        pending.delete(content);
                    }
                }
            }
        }
        assert.ok(saved.has(seed.id) || OPTIONS.samples === 0 || stopping);
    } finally {
        while (active) await new Promise(r => setTimeout(r, 250));
        for (const paginator of paginators) paginator.stop();
        const cleanupFailures = [];
        const clean = async operation => {
            try {
                await operation();
            } catch (error) {
                if (error.status !== 404) cleanupFailures.push({ status: error.status, code: error.code });
            }
        };
        if (temporaryCommand)
            await clean(() =>
                client.rest.delete(Routes.applicationGuildCommand(client.user.id, guildId, temporaryCommand.id))
            );
        // Delete exactly the resources this process created, never channel history or other commands.
        if (channel?.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages)) {
            const ids = [...owned];
            for (let index = 0; index < ids.length; index += 100) {
                const batch = ids.slice(index, index + 100);
                await clean(() =>
                    batch.length === 1
                        ? client.rest.delete(Routes.channelMessage(channelId, batch[0]))
                        : channel.bulkDelete(batch)
                );
            }
        } else {
            for (const id of owned) await clean(() => client.rest.delete(Routes.channelMessage(channelId, id)));
        }
        await client.destroy();
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        const groups = [];
        for (const flow of ["prefix", "slash", "component"])
            for (const app of [...OPTIONS.apps, "pagination"]) {
                const variants = {};
                for (const variant of ["baseline", "current", "control"]) {
                    const matches = rows.filter(
                        r =>
                            r.flow === flow &&
                            r.app === app &&
                            r.variant === variant &&
                            !r.warmup &&
                            !r.overlapped &&
                            !r.incomplete &&
                            !r.rateLimited &&
                            !r.failed
                    );
                    if (matches.length)
                        variants[variant] = {
                            ...summary(matches.map(r => r.ms)),
                            requestCounts: [...new Set(matches.map(r => r.requests.length))],
                            endToEnd: flow === "prefix" ? summary(matches.map(r => r.gatewayMs + r.ms)) : undefined,
                            rateLimited: matches.filter(r => r.rateLimited).length
                        };
                }
                if (Object.keys(variants).length)
                    groups.push({
                        flow,
                        app,
                        variants,
                        speedup: variants.baseline && variants.current ? variants.baseline.p50 / variants.current.p50 : null,
                        passes3x: Boolean(
                            variants.baseline && variants.current && variants.baseline.p50 / variants.current.p50 >= 3
                        )
                    });
            }
        const report = {
            node: process.version,
            ...hashes,
            options: OPTIONS,
            groups,
            rows,
            cleanupFailures,
            targetMet: groups.length > 0 && groups.every(g => g.passes3x)
        };
        if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
        console.log(
            JSON.stringify({
                event: "complete",
                groups,
                cleanedMessages: owned.size,
                cleanedCommand: Boolean(temporaryCommand),
                cleanupFailures
            })
        );
        if (cleanupFailures.length || (process.env.VIMCORD_BENCH_REQUIRE_3X === "1" && !report.targetMet))
            process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(JSON.stringify({ event: "failed", name: error.name, status: error.status, code: error.code }));
    process.exitCode = 1;
});
