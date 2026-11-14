import type { ClientEvents, Interaction, Message } from "discord.js";
import type { CommandPrefix } from "./CommandManager.js";

import { Collection, ContextMenuCommandBuilder, Routes, SlashCommandBuilder } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MessageContextCommandModule,
    PrefixCommandModule,
    SlashCommandModule,
    UserContextCommandModule
} from "@/modules/index.js";
import { Vimcord } from "../Vimcord.js";
import { CommandManager } from "./CommandManager.js";

type ApplicationCommandKind = "slash" | "message" | "user";

const CREATED_AT = 1_000;

let client: Vimcord | undefined;
let now = 0;

function advance(ms: number) {
    now += ms;
}

function createClient(commandLogging?: boolean) {
    client = new Vimcord({ intents: [], commandLogging });
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
    } as unknown as ClientEvents["messageCreate"][0];
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
            before: async () => {
                advance(5);
                return true;
            }
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

function createRegistrationClient() {
    return {
        user: { id: "app" },
        isReady: () => true,
        awaitReady: async () => true,
        guilds: { cache: new Collection(Array.from({ length: 12 }, (_, i) => [`guild-${i}`, { id: `guild-${i}` }])) },
        logger: { module: vi.fn(), debug: vi.fn(), error: vi.fn() },
        rest: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }
    };
}

function command(name: string, guilds?: string[]) {
    return {
        builder: { toJSON: vi.fn(() => ({ name, description: "d", type: 1 as const })) },
        registration: { guilds, global: !guilds }
    };
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
    it("includes waiting for client readiness in pre-execute", async () => {
        const client = createClient(true);
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
                timings: { delivery: 48, pre: 9, exec: 30 }
            })
        );
    });

    it("separates prefix preparation and user execution", async () => {
        const client = createClient(true);
        const command = new PrefixCommandModule({
            name: "balance",
            requiresReady: false,
            execute: function (this: PrefixCommandModule) {
                expect(this).toBe(command);
                advance(126);
            },
            hooks: {
                before: async () => {
                    advance(12);
                    return true;
                }
            }
        });
        client.modules.commands.prefix.register(command);

        await expect(client.modules.commands.dispatchMessage(createMessage(), ["!"])).resolves.toBe(true);
        expect(client.logger.commandUsed).toHaveBeenCalledWith({
            commandName: "balance",
            userName: "maya",
            guildName: "Workshop",
            failed: false,
            timings: { delivery: 48, pre: 12, exec: 126 }
        });
    });

    it.each(["slash", "message", "user"] as const)("counts %s deferral in pre-execute, not execution", async kind => {
        const client = createClient(true);
        const command = createApplicationCommand(kind, () => advance(126));
        if (command instanceof SlashCommandModule) client.modules.commands.slash.register(command);
        if (command instanceof MessageContextCommandModule) client.modules.commands.context.message.register(command);
        if (command instanceof UserContextCommandModule) client.modules.commands.context.user.register(command);

        const interaction = createInteraction(kind);
        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);

        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: { delivery: 48, pre: 12, exec: 126 }
            })
        );
    });

    it("measures the selected slash route after its checks and route-specific deferral", async () => {
        const client = createClient(true);
        const execute = vi.fn();
        const command = new SlashCommandModule({
            builder: new SlashCommandBuilder()
                .setName("balance")
                .setDescription("Balance")
                .addSubcommand(s => s.setName("view").setDescription("View")),
            requiresReady: false,
            deferReply: false,
            execute,
            subcommands: {
                view: { deferReply: true, execute: () => advance(20) }
            },
            hooks: {
                before: async () => {
                    advance(4);
                    return true;
                }
            }
        });
        client.modules.commands.slash.register(command);
        const interaction = createInteraction("slash", "view");

        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);

        expect(execute).not.toHaveBeenCalled();
        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: { delivery: 48, pre: 11, exec: 20 }
            })
        );
    });

    it("finishes execution timing before awaited error handling", async () => {
        const client = createClient(true);
        const command = new PrefixCommandModule({
            name: "balance",
            requiresReady: false,
            execute: () => {
                advance(30);
                throw new Error("failed");
            },
            hooks: {
                before: async () => {
                    advance(12);
                    return true;
                },
                onError: async () => advance(6)
            }
        });
        client.modules.commands.prefix.register(command);

        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);

        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                failed: true,
                timings: { delivery: 48, pre: 12, exec: 30 }
            })
        );
    });

    it("does not log when deferral fails before the handler executes", async () => {
        const client = createClient(true);
        const execute = vi.fn();
        const command = createApplicationCommand("slash", execute);
        if (!(command instanceof SlashCommandModule)) throw new Error("Expected slash command");
        client.modules.commands.slash.register(command);
        const interaction = createInteraction();
        interaction.deferReply.mockRejectedValue(new Error("defer failed"));
        await client.modules.commands.dispatchInteraction(interaction as unknown as Interaction);
        expect(execute).not.toHaveBeenCalled();
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
    });

    it("includes prompt waits and keeps overlapping invocations independent", async () => {
        const client = createClient(true);
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
                timings: { delivery: 48, pre: 0, exec: 30 }
            })
        );
        expect(client.logger.commandUsed).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                userName: "first",
                timings: { delivery: 48, pre: 0, exec: 90 }
            })
        );
    });

    it("does not invent delivery duration for clock skew or use wall-clock changes for local spans", async () => {
        const client = createClient(true);
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
                timings: { delivery: undefined, pre: 0, exec: 30 }
            })
        );
    });
});

describe("CommandManager logging", () => {
    it("does not emit usage logs for autocomplete", async () => {
        const client = createClient(true);
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

    it.each([undefined, true, false])("uses boolean logging=%s", async logging => {
        const client = createClient(logging);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: () => advance(30)
            })
        );
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        if (logging === false) expect(client.logger.commandUsed).not.toHaveBeenCalled();
        else
            expect(client.logger.commandUsed).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    timings: { delivery: 48, pre: 0, exec: 30 }
                })
            );
    });

    it.each([false, true])("makes no usage clock calls when off (staged=%s)", async staged => {
        const client = createClient(false);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                hooks: staged ? { before: () => true } : undefined,
                execute: () => undefined
            })
        );
        vi.mocked(performance.now).mockClear();
        vi.mocked(Date.now).mockClear();
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(performance.now).not.toHaveBeenCalled();
        expect(Date.now).not.toHaveBeenCalled();
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
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

        client.globals.app.commandLogging = true;
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: { delivery: 48, pre: 0, exec: 30 }
            })
        );

        vi.mocked(client.logger.commandUsed).mockClear();
        client.globals.app.commandLogging = false;
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
    });

    it.each(["disabled", "before", "permission"] as const)("does not log a command blocked by %s", async reason => {
        const client = createClient(true);
        const execute = vi.fn();
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                enabled: reason !== "disabled",
                access: reason === "permission" ? { staff: true } : {},
                hooks: reason === "before" ? { before: async () => false } : {},
                execute
            })
        );

        await expect(client.modules.commands.dispatchMessage(createMessage(), ["!"])).resolves.toBe(true);
        expect(execute).not.toHaveBeenCalled();
        expect(client.logger.commandUsed).not.toHaveBeenCalled();
    });
});

describe("CommandManager registration preparation", () => {
    it("builds once per sync, targets explicit guilds within bounded workers, and a filtered push deletes nothing", async () => {
        const client = createRegistrationClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        const all = command("all");
        const targeted = command("targeted", ["guild-0"]);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([all, targeted] as never);
        let inFlight = 0;
        let maximum = 0;
        client.rest.get.mockImplementation(async () => {
            maximum = Math.max(maximum, ++inFlight);
            await new Promise(r => setImmediate(r));
            inFlight--;
            return [
                { id: "unchanged", name: "all", description: "d", type: 1 },
                { id: "unrelated", name: "remote", type: 1 }
            ];
        });
        const guilds = [...client.guilds.cache.keys()];
        expect(await manager.pushByGuild({ guilds, tag: "core" })).toBe(true);
        expect(all.builder.toJSON).toHaveBeenCalledOnce();
        expect(targeted.builder.toJSON).toHaveBeenCalledOnce();
        expect(maximum).toBeLessThanOrEqual(5);
        expect(maximum).toBeGreaterThan(1);
        expect(client.rest.patch).not.toHaveBeenCalled();
        expect(client.rest.put).not.toHaveBeenCalled();
        expect(client.rest.delete).not.toHaveBeenCalled();
        expect(client.rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild-0"), {
            body: { name: "targeted", description: "d", type: 1 }
        });
    });

    it("pushes only guild-scoped commands to the guilds they name when no guilds are given, pruning there", async () => {
        const client = createRegistrationClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([command("all"), command("staff", ["guild-3"])] as never);
        client.rest.get.mockResolvedValue([{ id: "old", name: "renamed", type: 1 }]);

        expect(await manager.pushByGuild()).toBe(true);
        expect(client.rest.get).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild-3"));
        expect(client.rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild-3"), {
            body: { name: "staff", description: "d", type: 1 }
        });
        expect(client.rest.delete).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommand("app", "guild-3", "old"));
    });

    it("keeps syncing other guilds after one fails, and reports the failure", async () => {
        const client = createRegistrationClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([command("staff", ["guild-1", "guild-2"])] as never);
        client.rest.get.mockImplementation(async (route: string) => {
            if (route.includes("guild-1")) throw new Error("Missing Access");
            return [];
        });

        expect(await manager.pushByGuild()).toBe(false);
        expect(client.rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild-2"), {
            body: { name: "staff", description: "d", type: 1 }
        });
        expect(client.logger.error).toHaveBeenCalledOnce();
    });

    it("deletes stale global commands only on an unfiltered push", async () => {
        const client = createRegistrationClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([command("kept"), command("staff", ["guild-0"])] as never);
        client.rest.get.mockResolvedValue([
            { id: "kept-id", name: "kept", description: "d", type: 1, contexts: [0, 1, 2] },
            { id: "user-kept", name: "kept", type: 2 },
            { id: "staff-id", name: "staff", description: "d", type: 1 }
        ]);

        await manager.push({ names: ["kept"] });
        expect(client.rest.delete).not.toHaveBeenCalled();

        await manager.push();
        expect(client.rest.delete.mock.calls).toEqual([
            [Routes.applicationCommand("app", "user-kept")],
            [Routes.applicationCommand("app", "staff-id")]
        ]);
        expect(client.rest.post).not.toHaveBeenCalled();
        expect(client.rest.patch).not.toHaveBeenCalled();
    });

    it("patches by existing identity without replacing unchanged commands or deleting unrelated commands", async () => {
        const client = createRegistrationClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([command("changed"), command("new")] as never);
        client.rest.get.mockResolvedValue([{ id: "same-id", name: "changed", description: "old", type: 1 }] as never);
        await manager.pushByGuild({ guilds: ["guild-0"] });
        expect(client.rest.patch).toHaveBeenCalledWith(Routes.applicationGuildCommand("app", "guild-0", "same-id"), {
            body: { name: "changed", description: "d", type: 1 }
        });
        expect(client.rest.post).toHaveBeenCalledWith(Routes.applicationGuildCommands("app", "guild-0"), {
            body: { name: "new", description: "d", type: 1 }
        });
        expect(client.rest.put).not.toHaveBeenCalled();
    });
});

describe("CommandManager routing lifecycle", () => {
    it("installs once, replaces prefix settings, and preserves other listeners on removal", () => {
        const client = createClient(false);
        const commands = client.modules.commands;
        const external = vi.fn();
        client.on("interactionCreate", external);
        const dispatchInteraction = vi.spyOn(commands, "dispatchInteraction").mockResolvedValue(true);
        const dispatchMessage = vi.spyOn(commands, "dispatchMessage").mockResolvedValue(true);
        commands.installListeners({ prefix: "!" });
        const routing = { prefix: ["?"], allowMention: true };
        commands.installListeners(routing);
        const interaction = createInteraction() as unknown as Interaction;
        const message = createMessage();
        client.emit("interactionCreate", interaction);
        client.emit("messageCreate", message);
        expect(dispatchInteraction).toHaveBeenCalledExactlyOnceWith(interaction);
        expect(dispatchMessage).toHaveBeenCalledExactlyOnceWith(message, ["?"], routing);
        commands.removeListeners();
        commands.removeListeners();
        expect(client.listeners("interactionCreate")).toEqual([external]);
        expect(client.listeners("messageCreate")).toEqual([]);
    });

    it("installs only interactions by default, supports mention-only routing, and cleans up on unload", () => {
        const client = createClient(false);
        const commands = client.modules.commands;
        commands.installListeners();
        expect(client.listenerCount("interactionCreate")).toBe(1);
        expect(client.listenerCount("messageCreate")).toBe(0);
        commands.installListeners({ allowMention: true });
        expect(client.listenerCount("messageCreate")).toBe(1);
        client.modules.unload();
        expect(client.listenerCount("interactionCreate")).toBe(0);
        expect(client.listenerCount("messageCreate")).toBe(0);
    });

    it("warns when prefix commands are loaded but nothing can route to them", () => {
        const client = createClient(false);
        const warn = vi.spyOn(client.logger, "warn").mockImplementation(() => {});
        client.modules.commands.prefix.register(new PrefixCommandModule({ name: "balance", execute: vi.fn() }));
        client.modules.commands.installListeners();
        expect(warn).toHaveBeenCalledOnce();
    });

    it("dispatches commands without invoking handlers for bot messages", async () => {
        const client = createClient(false);
        const execute = vi.fn();
        client.modules.commands.prefix.register(new PrefixCommandModule({ name: "balance", requiresReady: false, execute }));
        client.modules.commands.installListeners({ prefix: "!" });
        const message = createMessage();
        client.emit("messageCreate", message);
        expect(execute).toHaveBeenCalledOnce();
        const bot = { ...message, author: { ...message.author, bot: true } } as typeof message;
        client.emit("messageCreate", bot);
        await Promise.resolve();
        expect(execute).toHaveBeenCalledOnce();
    });
});

describe("prefix function", () => {
    function setup(prefix: CommandPrefix, allowMention = false) {
        const client = createClient(false);
        const execute = vi.fn();
        client.modules.commands.prefix.register(new PrefixCommandModule({ name: "balance", requiresReady: false, execute }));
        client.modules.commands.installListeners({ prefix, allowMention });
        return { client, execute };
    }

    const settle = () => new Promise(resolve => setImmediate(resolve));

    it.each([
        ["string", () => "!"],
        ["array", () => ["?", "!"]],
        ["async string", async () => "!"]
    ])("dispatches a %s result once per message", async (_kind, resolve) => {
        const resolver = vi.fn(resolve);
        const { client, execute } = setup(resolver);
        client.emit("messageCreate", createMessage());
        await settle();
        expect(resolver).toHaveBeenCalledOnce();
        expect(execute).toHaveBeenCalledOnce();
    });

    it("ignores the message on null, even when mentions are allowed", async () => {
        const { client, execute } = setup(() => null, true);
        Object.assign(client, { user: { id: "1" } });
        const message = createMessage();
        message.content = "<@1> balance";
        client.emit("messageCreate", message);
        await settle();
        expect(execute).not.toHaveBeenCalled();
    });

    it("matches the mention prefix alongside the function's result", async () => {
        const { client, execute } = setup(() => [], true);
        Object.assign(client, { user: { id: "1" } });
        const message = createMessage();
        message.content = "<@1> balance";
        client.emit("messageCreate", message);
        await settle();
        expect(execute).toHaveBeenCalledOnce();
    });

    it.each([
        [
            "sync",
            () => {
                throw new Error("lookup failed");
            }
        ],
        [
            "async",
            async () => {
                throw new Error("lookup failed");
            }
        ]
    ])("logs a %s failure instead of raising it into the event emitter", async (_kind, resolve) => {
        const { client, execute } = setup(resolve);
        expect(() => client.emit("messageCreate", createMessage())).not.toThrow();
        await settle();
        expect(execute).not.toHaveBeenCalled();
        expect(client.logger.error).toHaveBeenCalledOnce();
    });

    it("skips the resolver for a message with no content", () => {
        const resolver = vi.fn(() => "!");
        const { client } = setup(resolver);
        const message = createMessage();
        message.content = "";
        client.emit("messageCreate", message);
        expect(resolver).not.toHaveBeenCalled();
    });
});

describe("direct command execution", () => {
    it("awaits thenable handlers on the direct path with all fixed timings", async () => {
        const client = createClient(true);
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                execute: () => ({
                    then: (resolve: (value: string) => void) => {
                        advance(30);
                        resolve("done");
                    }
                })
            })
        );
        const message = createMessage();
        vi.mocked(Date.now).mockClear();
        vi.mocked(performance.now).mockClear();
        await expect(client.modules.commands.dispatchMessage(message, ["!"])).resolves.toBe(true);
        expect(Date.now).toHaveBeenCalledOnce();
        expect(performance.now).toHaveBeenCalledTimes(3);
        expect(client.logger.commandUsed).toHaveBeenCalledWith(
            expect.objectContaining({
                timings: { delivery: 48, pre: 0, exec: 30 },
                failed: false
            })
        );
    });

    it("keeps thenable rejection timing separate from error hooks", async () => {
        const client = createClient(true);
        const error = new Error("Query failed");
        const onError = vi.fn(async () => advance(8));
        client.modules.commands.prefix.register(
            new PrefixCommandModule({
                name: "balance",
                requiresReady: false,
                hooks: { onError },
                execute: () => ({
                    then: (_resolve: unknown, reject: (error: Error) => void) => {
                        advance(30);
                        reject(error);
                    }
                })
            })
        );
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(onError).toHaveBeenCalledWith(expect.anything(), error);
        expect(client.logger.commandUsed).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                timings: { delivery: 48, pre: 0, exec: 30 },
                failed: true
            })
        );
    });

    it("observes a before hook added after the first direct invocation", async () => {
        const client = createClient(false);
        const execute = vi.fn();
        const command = new PrefixCommandModule({ name: "balance", requiresReady: false, execute });
        client.modules.commands.prefix.register(command);
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        command.hooks.before = async () => false;
        await client.modules.commands.dispatchMessage(createMessage(), ["!"]);
        expect(execute).toHaveBeenCalledOnce();
    });

    it.each(["!bank deposit 5", "!  BANK\tDEPOSIT\t5", "!wallet   put  5"])(
        "preserves routing and context args for %s",
        async content => {
            const client = createClient(false);
            const handler = vi.fn();
            let args: string[] = [];
            client.modules.commands.prefix.register(
                new PrefixCommandModule({
                    name: "bank",
                    aliases: ["wallet"],
                    requiresReady: false,
                    subcommands: { deposit: { aliases: ["put"], execute: handler } },
                    hooks: {
                        before: async ctx => {
                            args = ctx.args;
                            return true;
                        }
                    }
                })
            );
            const message = createMessage();
            message.content = content;
            await client.modules.commands.dispatchMessage(message, ["!"]);
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({ subcommand: "deposit", content: "5" }));
            expect(args).toEqual(["5"]);
        }
    );
});
