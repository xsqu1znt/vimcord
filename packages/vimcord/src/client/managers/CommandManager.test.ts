import type { Interaction, Message } from "discord.js";
import type { CommandLoggingTiming } from "../globals.js";

import { ContextMenuCommandBuilder, SlashCommandBuilder } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MessageContextCommandModule,
    PrefixCommandModule,
    SlashCommandModule,
    UserContextCommandModule
} from "@/modules/index.js";
import { Vimcord } from "../Vimcord.js";

type ApplicationCommandKind = "slash" | "message" | "user";

const ALL_TIMINGS = ["delivery", "preExecute", "execute", "total"] as const;
const CREATED_AT = 1_000;

let client: Vimcord | undefined;
let now = 0;

function advance(ms: number) {
    now += ms;
}

function createClient(commandLogging?: false | readonly CommandLoggingTiming[]) {
    client = new Vimcord({ client: { intents: [] }, globals: { app: { commandLogging } } });
    vi.spyOn(client.logger, "commandUsed").mockImplementation(() => {});
    vi.spyOn(client.logger, "error").mockImplementation(() => {});
    return client;
}

function createMessage(userName = "maya") {
    return {
        content: "!balance",
        author: { id: userName, username: userName, bot: false },
        guild: { id: "guild", name: "Workshop" },
        guildId: "guild",
        createdTimestamp: CREATED_AT
    } as unknown as Message;
}

function createInteraction(kind: ApplicationCommandKind = "slash", subcommand: string | null = null) {
    return {
        commandName: "balance",
        user: { id: "maya", username: "maya", bot: false },
        guild: { id: "guild", name: "Workshop" },
        guildId: "guild",
        member: null,
        memberPermissions: null,
        appPermissions: null,
        createdTimestamp: CREATED_AT,
        replied: false,
        deferred: false,
        deferReply: vi.fn(async () => advance(7)),
        isChatInputCommand: () => kind === "slash",
        isContextMenuCommand: () => kind !== "slash",
        isMessageContextMenuCommand: () => kind === "message",
        isUserContextMenuCommand: () => kind === "user",
        isAutocomplete: () => false,
        options: { getSubcommand: () => subcommand, getSubcommandGroup: () => null }
    };
}

function createApplicationCommand(kind: ApplicationCommandKind, execute: () => unknown) {
    const options = {
        requiresReady: false,
        deferReply: true,
        execute,
        hooks: {
            preExecute: async (_ctx: unknown, next: () => void) => {
                advance(5);
                next();
            },
            postExecute: async () => advance(4)
        }
    };

    if (kind === "slash") {
        return new SlashCommandModule({
            ...options,
            builder: new SlashCommandBuilder().setName("balance").setDescription("Balance")
        });
    }

    const builder = new ContextMenuCommandBuilder().setName("balance");
    if (kind === "message") return new MessageContextCommandModule({ ...options, builder });
    return new UserContextCommandModule({ ...options, builder });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(Date, "now").mockReturnValue(CREATED_AT + 48);
});

afterEach(async () => {
    await client?.destroy();
    client = undefined;
    vi.restoreAllMocks();
});

describe("CommandManager usage timing", () => {
    it("includes waiting for client readiness in pre-execute and total", async () => {
        const client = createClient(ALL_TIMINGS);
        vi.spyOn(client, "isReady").mockReturnValue(false);
        vi.spyOn(client, "awaitReady").mockImplementation(async () => {
            advance(9);
            return true;
        });
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                execute: () => advance(30)
            })
        );

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: [
                    { timing: "delivery", durationMs: 48 },
                    { timing: "preExecute", durationMs: 9 },
                    { timing: "execute", durationMs: 30 },
                    { timing: "total", durationMs: 39 }
                ]
            })
        );
    });

    it("separates prefix preparation, user execution, and post-execute work", async () => {
        const client = createClient(ALL_TIMINGS);
        const command = new PrefixCommandModule({
            name: "balance",
            requiresReady: false,
            execute: function (this: PrefixCommandModule) {
                expect(this).toBe(command);
                advance(126);
            },
            hooks: {
                preExecute: async (_ctx, next) => {
                    advance(12);
                    next();
                },
                postExecute: async () => advance(4)
            }
        });
        client.modules.commands.prefix.register(command);

        await expect(client.modules.commands.dispatchMessage(createMessage(), ["!"])).resolves.toBe(true);
        expect(client.logger.commandUsed).toHaveBeenCalledWith({
            commandName: "balance",
            userName: "maya",
            guildName: "Workshop",
            guildId: "guild",
            durationMs: 142,
            failed: false,
            timings: [
                { timing: "delivery", durationMs: 48 },
                { timing: "preExecute", durationMs: 12 },
                { timing: "execute", durationMs: 126 },
                { timing: "total", durationMs: 142 }
            ]
        });
    });

    it.each(["slash", "message", "user"] as const)("counts %s deferral in pre-execute, not execution", async kind => {
        const client = createClient(ALL_TIMINGS);
        const command = createApplicationCommand(kind, () => advance(126));
        if (command instanceof SlashCommandModule) client.modules.commands.slash.register(command);
        if (command instanceof MessageContextCommandModule) client.modules.commands.context.message.register(command);
        if (command instanceof UserContextCommandModule) client.modules.commands.context.user.register(command);

        const interaction = createInteraction(kind);
        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);

        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                durationMs: 142,
                timings: [
                    { timing: "delivery", durationMs: 48 },
                    { timing: "preExecute", durationMs: 12 },
                    { timing: "execute", durationMs: 126 },
                    { timing: "total", durationMs: 142 }
                ]
            })
        );
    });

    it("measures the selected slash route after its checks and route-specific deferral", async () => {
        const client = createClient(ALL_TIMINGS);
        const execute = vi.fn();
        const command = new SlashCommandModule({
            builder: new SlashCommandBuilder()
                .setName("balance")
                .setDescription("Balance")
                .addSubcommand(s => s.setName("view").setDescription("View")),
            requiresReady: false,
            deferReply: false,
            execute,
            conditions: [
                () => {
                    advance(3);
                    return { passed: true };
                }
            ],
            routes: [
                {
                    path: "view",
                    deferReply: true,
                    conditions: [
                        () => {
                            advance(5);
                            return { passed: true };
                        }
                    ],
                    handler: () => advance(20)
                }
            ],
            hooks: {
                preExecute: async (_ctx, next) => {
                    advance(4);
                    next();
                },
                postExecute: async () => advance(6)
            }
        });
        client.modules.commands.slash.register(command);
        const interaction = createInteraction("slash", "view");

        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);

        expect(execute).not.toHaveBeenCalled();
        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: [
                    { timing: "delivery", durationMs: 48 },
                    { timing: "preExecute", durationMs: 19 },
                    { timing: "execute", durationMs: 20 },
                    { timing: "total", durationMs: 45 }
                ]
            })
        );
    });

    it("finishes execution timing before awaited error handling", async () => {
        const client = createClient(ALL_TIMINGS);
        const command = new PrefixCommandModule({
            name: "balance",
            requiresReady: false,
            execute: () => {
                advance(30);
                throw new Error("failed");
            },
            hooks: {
                preExecute: async (_ctx, next) => {
                    advance(12);
                    next();
                },
                onError: async () => advance(6)
            }
        });
        client.modules.commands.prefix.register(command);

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                failed: true,
                timings: [
                    { timing: "delivery", durationMs: 48 },
                    { timing: "preExecute", durationMs: 12 },
                    { timing: "execute", durationMs: 30 },
                    { timing: "total", durationMs: 48 }
                ]
            })
        );
    });

    it("retains handler duration when post-execute throws", async () => {
        const client = createClient(["execute", "total"]);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: () => advance(30),
                hooks: {
                    postExecute: async () => {
                        advance(5);
                        throw new Error("post failed");
                    },
                    onError: async () => advance(6)
                }
            })
        );

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                failed: true,
                timings: [
                    { timing: "execute", durationMs: 30 },
                    { timing: "total", durationMs: 41 }
                ]
            })
        );
    });

    it("leaves pre-execute and execute unavailable when deferral fails before the handler", async () => {
        const client = createClient(ALL_TIMINGS);
        const execute = vi.fn();
        const command = createApplicationCommand("slash", execute);
        if (!(command instanceof SlashCommandModule)) throw new Error("Expected slash command");
        client.modules.commands.slash.register(command);
        const interaction = createInteraction();
        interaction.deferReply.mockImplementation(async () => {
            advance(7);
            throw new Error("defer failed");
        });

        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);

        expect(execute).not.toHaveBeenCalled();
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                failed: true,
                timings: [
                    { timing: "delivery", durationMs: 48 },
                    { timing: "preExecute", durationMs: undefined },
                    { timing: "execute", durationMs: undefined },
                    { timing: "total", durationMs: 12 }
                ]
            })
        );
    });

    it("includes prompt waits and keeps overlapping invocations independent", async () => {
        const client = createClient(["execute", "total"]);
        const waits = { first: deferred(), second: deferred() };
        const started = { first: deferred(), second: deferred() };
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: async ctx => {
                    const key = ctx.message.author.username === "first" ? "first" : "second";
                    started[key].resolve();
                    await waits[key].promise;
                }
            })
        );

        const first = client.modules.commands.dispatchMessage(createMessage("first"), ["!"]);
        await started.first.promise;
        advance(10);
        const second = client.modules.commands.dispatchMessage(createMessage("second"), ["!"]);
        await started.second.promise;
        expect(client.logger.commandUsed).not.toHaveBeenCalled();

        advance(30);
        waits.second.resolve();
        await second;
        advance(50);
        waits.first.resolve();
        await first;

        expect(client.logger.commandUsed).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                userName: "second",
                timings: [
                    { timing: "execute", durationMs: 30 },
                    { timing: "total", durationMs: 30 }
                ]
            })
        );
        expect(client.logger.commandUsed).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                userName: "first",
                timings: [
                    { timing: "execute", durationMs: 90 },
                    { timing: "total", durationMs: 90 }
                ]
            })
        );
    });

    it("does not invent delivery duration for clock skew or use wall-clock changes for local spans", async () => {
        const client = createClient(ALL_TIMINGS);
        vi.mocked(Date.now).mockReturnValue(CREATED_AT - 48);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: () => {
                    vi.mocked(Date.now).mockReturnValue(CREATED_AT + 10_000);
                    advance(30);
                }
            })
        );

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: [
                    { timing: "delivery", durationMs: undefined },
                    { timing: "preExecute", durationMs: 0 },
                    { timing: "execute", durationMs: 30 },
                    { timing: "total", durationMs: 30 }
                ]
            })
        );
    });
});

describe("CommandManager logging selection", () => {
    it("does not emit usage logs for autocomplete", async () => {
        const client = createClient(ALL_TIMINGS);
        const execute = vi.fn();
        client.modules.commands.slash.register(
            new SlashCommandModule({
                builder: new SlashCommandBuilder().setName("balance").setDescription("Balance"),
                requiresReady: false,
                execute,
                autocomplete: () => []
            })
        );
        const interaction = {
            ...createInteraction(),
            isChatInputCommand: () => false,
            isAutocomplete: () => true,
            options: {
                getSubcommand: () => null,
                getSubcommandGroup: () => null,
                getFocused: () => ({ name: "query", value: "", focused: true })
            },
            responded: false,
            respond: vi.fn(async () => {})
        };

        await expect(client.modules.commands.dispatchInteraction(interaction as unknown as Interaction)).resolves.toBe(true);
        expect(interaction.respond).toHaveBeenCalledWith([]);
        expect(execute).not.toHaveBeenCalled();
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
    });

    it.each([
        { global: undefined, local: undefined, selected: ["execute"] },
        { global: false, local: undefined, selected: null },
        { global: [], local: undefined, selected: null },
        { global: false, local: true, selected: ["execute"] },
        { global: [], local: true, selected: ["execute"] },
        { global: ["total", "execute"], local: undefined, selected: ["total", "execute"] },
        { global: ["total", "execute"], local: true, selected: ["total", "execute"] },
        { global: ["total"], local: false, selected: null },
        { global: undefined, local: false, selected: null },
        { global: false, local: false, selected: null }
    ] as const)("resolves global=$global and logUsage=$local", async ({ global, local, selected }) => {
        const client = createClient(global);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                metadata: { logUsage: local },
                execute: () => advance(30)
            })
        );

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        if (selected === null) {
            expect(client.logger.commandUsed).not.toHaveBeenCalled();
            return;
        }
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: selected.map(t => ({ timing: t, durationMs: 30 }))
            })
        );
    });

    it("uses updated logging configuration on later invocations", async () => {
        const client = createClient();
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: () => advance(30)
            })
        );

        client.configure({ app: { commandLogging: ["total", "execute"] } });
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: [
                    { timing: "total", durationMs: 30 },
                    { timing: "execute", durationMs: 30 }
                ]
            })
        );

        vi.mocked(client.logger.commandUsed).mockClear();
        client.configure({ app: { commandLogging: false } });
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
    });

    it.each(["disabled", "condition", "preExecute", "permission"] as const)(
        "does not log a command blocked by %s",
        async reason => {
            const client = createClient(ALL_TIMINGS);
            const execute = vi.fn();
            client.modules.commands.prefix.register(
                new PrefixCommandModule({
                    name: "balance",
                    requiresReady: false,
                    enabled: reason !== "disabled",
                    conditions: reason === "condition" ? [() => ({ passed: false, reason: "blocked" })] : [],
                    permissions: reason === "permission" ? { botStaff: true } : {},
                    hooks: reason === "preExecute" ? { preExecute: async () => {} } : {},
                    execute
                })
            );

            await expect(client.modules.commands.dispatchMessage(createMessage(), ["!"])).resolves.toBe(true);
            expect(execute).not.toHaveBeenCalled();
            expect(client.logger.commandUsed).not.toHaveBeenCalled();
        }
    );
});
