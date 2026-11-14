import type { Message } from "discord.js";
import type { CommandModuleContext, CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";
import type { GlobalCommandHooks } from "@/commands/commandHooks.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppGlobals, defaultStaffGlobals } from "@/client/globals.js";
import { applyUxConfig, uxConfig } from "@/ux/uxConfig.js";
import { PrefixCommandModule } from "./PrefixCommandModule.js";

const DEFAULT_COMMAND_MESSAGES = { ...uxConfig.command };

afterEach(() => {
    applyUxConfig({ command: DEFAULT_COMMAND_MESSAGES });
});

function createClient() {
    return {
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), options: { verbose: false } },
        globals: { app: defaultAppGlobals(), staff: defaultStaffGlobals(), hooks: undefined }
    } as unknown as Vimcord;
}

function createMessage(content: string) {
    return {
        content,
        author: { id: "user", bot: false },
        guildId: null,
        guild: null,
        member: null,
        channel: {},
        reply: vi.fn(async () => undefined)
    } as unknown as Message;
}

describe("PrefixCommandModule subcommands", () => {
    it.each(["frame", "FRAME", "FrAmE", "f", "F"])("routes %s with remaining content and canonical name", async token => {
        const handler = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => ({
            name: ctx.subcommand,
            content: ctx.content,
            args: ctx.args,
            lower: ctx.lowerArgs
        }));
        const execute = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            subcommands: { Frame: { aliases: ["f"], description: "Buy a frame", execute: handler } },
            execute
        });
        module.inject(createClient());
        const message = createMessage(`!  buy  ${token}\t  Red,Blue  2  `);

        expect(await module.run(message, "!", "buy")).toEqual({
            name: "frame",
            content: "Red,Blue  2",
            args: ["Red,Blue", "2"],
            lower: ["red,blue", "2"]
        });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].message).toBe(message);
        expect(execute).not.toHaveBeenCalled();
        expect(module.subcommands.get("frame")).toMatchObject({ description: "Buy a frame", aliases: ["f"] });
    });

    it.each(["", "unknown Keep CASE"])("falls back with original args for '%s'", async content => {
        const execute = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => [
            ctx.subcommand,
            ctx.content,
            ctx.args
        ]);
        const handler = vi.fn();
        const module = new PrefixCommandModule({ name: "buy", subcommands: { frame: { execute: handler } }, execute });
        module.inject(createClient());

        expect(await module.run(createMessage(`!buy ${content}`), "!", "buy")).toEqual([
            null,
            content,
            content ? ["unknown", "Keep", "CASE"] : []
        ]);
        expect(execute).toHaveBeenCalledOnce();
        expect(handler).not.toHaveBeenCalled();
    });

    it("supports subcommands-only modules and blocks an unmatched token as unknownRoute", async () => {
        const handler = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => ctx.args);
        const onBlocked = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            subcommands: { frame: { execute: handler } },
            hooks: { onBlocked }
        });
        module.inject(createClient());
        expect(await module.run(createMessage("!buy frame"), "!", "buy")).toEqual([]);
        expect(await module.run(createMessage("!buy Unknown thing"), "!", "buy")).toBeUndefined();
        expect(await module.run(createMessage("!buy"), "!", "buy")).toBeUndefined();
        expect(handler).toHaveBeenCalledOnce();
        expect(onBlocked.mock.calls.map(call => call[1])).toEqual([
            { kind: "unknownRoute", path: "unknown" },
            { kind: "unknownRoute", path: "" }
        ]);
    });

    it("runs the client's hooks once with the matched subcommand", async () => {
        const before = vi.fn(async (ctx: CommandModuleHookContext<CommandModuleType.Prefix>) => {
            expect(ctx.subcommand).toBe("frame");
            expect(ctx.args).toEqual(["Red"]);
            return true;
        });
        const handler = vi.fn(() => "bought");
        const module = new PrefixCommandModule({ name: "buy", subcommands: { frame: { execute: handler } } });
        const client = createClient();
        client.globals.hooks = { prefix: { before } };
        module.inject(client);

        expect(await module.run(createMessage("!buy frame Red"), "!", "buy")).toBe("bought");
        expect(before).toHaveBeenCalledOnce();
    });

    it("runs the client's before first, and a module's before can't skip it", async () => {
        const calls: string[] = [];
        const execute = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            execute,
            hooks: {
                before: () => {
                    calls.push("module");
                    return true;
                }
            }
        });
        const client = createClient();
        const clientBefore = vi.fn(() => {
            calls.push("client");
            return true;
        });
        client.globals.hooks = { prefix: { before: clientBefore } };
        module.inject(client);

        await module.run(createMessage("!buy"), "!", "buy");
        expect(calls).toEqual(["client", "module"]);
        expect(execute).toHaveBeenCalledOnce();

        calls.length = 0;
        clientBefore.mockReturnValueOnce(false);
        await module.run(createMessage("!buy"), "!", "buy");
        expect(calls).toEqual([]);
        expect(execute).toHaveBeenCalledOnce();
    });

    it("prefers a module's onBlocked over the client's", async () => {
        const local = vi.fn();
        const global = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            execute: () => {},
            access: { users: ["other"] },
            hooks: { onBlocked: local }
        });
        const client = createClient();
        client.globals.hooks = { prefix: { onBlocked: global } };
        module.inject(client);

        await module.run(createMessage("!buy"), "!", "buy");
        expect(local).toHaveBeenCalledOnce();
        expect(global).not.toHaveBeenCalled();
    });

    it("does not bypass parent restrictions or a before gate", async () => {
        const handler = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            access: { users: ["other"] },
            subcommands: { frame: { execute: handler } }
        });
        module.inject(createClient());
        expect((await module.runWithResult(createMessage("!buy frame"), "!", "buy")).executed).toBe(false);

        const halted = new PrefixCommandModule({
            name: "buy",
            hooks: { before: async () => false },
            subcommands: { frame: { execute: handler } }
        });
        halted.inject(createClient());
        expect((await halted.runWithResult(createMessage("!buy frame"), "!", "buy")).executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it("tests a subcommand's restrictions on modules that would otherwise run directly", async () => {
        const handler = vi.fn();
        const execute = vi.fn();
        const onBlocked = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            execute,
            subcommands: { frame: { execute: handler, guildOnly: true } },
            hooks: { onBlocked }
        });
        const client = createClient();
        client.globals.app.commandLogging = false;
        module.inject(client);

        await module.dispatch(createMessage("!buy frame"), "!", "buy");
        expect(handler).not.toHaveBeenCalled();
        expect(onBlocked).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            expect.objectContaining({ kind: "permission", reason: "NotInGuild" })
        );

        await module.dispatch(createMessage("!buy"), "!", "buy");
        expect(execute).toHaveBeenCalledOnce();
    });

    it("lets a subcommand's allowBots open just that subcommand to bots", async () => {
        const open = vi.fn();
        const closed = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            subcommands: { open: { allowBots: true, execute: open }, closed: { execute: closed } }
        });
        module.inject(createClient());
        const fromBot = (content: string) => {
            const message = createMessage(content);
            Object.assign(message.author, { bot: true });
            return message;
        };

        await module.run(fromBot("!buy open"), "!", "buy");
        await module.run(fromBot("!buy closed"), "!", "buy");

        expect(open).toHaveBeenCalledOnce();
        expect(closed).not.toHaveBeenCalled();
    });

    it("rejects ambiguous subcommand aliases at construction", () => {
        expect(
            () =>
                new PrefixCommandModule({
                    name: "buy",
                    subcommands: {
                        frame: { aliases: ["EFFECT"], execute: () => {} },
                        effect: { execute: () => {} }
                    }
                })
        ).toThrow(/duplicate/);
    });

    it("exposes the author as ctx.user and parses args only when read", async () => {
        const split = vi.spyOn(String.prototype, "split");
        const module = new PrefixCommandModule({
            name: "buy",
            execute: ctx => {
                expect(split).not.toHaveBeenCalled();
                expect(ctx.args).toBe(ctx.args);
                return ctx.user;
            }
        });
        module.inject(createClient());
        const message = createMessage("!buy A B");
        expect(await module.run(message, "!", "buy")).toBe(message.author);
        expect(split).toHaveBeenCalledOnce();
        split.mockRestore();
    });

    it("keeps args readable after a context is spread", async () => {
        const module = new PrefixCommandModule({ name: "buy", execute: ctx => ({ ...ctx }).args });
        module.inject(createClient());
        expect(await module.run(createMessage("!buy A B"), "!", "buy")).toEqual(["A", "B"]);
    });
});

describe("PrefixCommandModule hook resolution", () => {
    it("runs shared, then prefix, then the module's before, stopping at the first denial", async () => {
        const calls: string[] = [];
        const gate =
            (name: string, result = true) =>
            () => (calls.push(name), result);
        const execute = vi.fn();
        const module = new PrefixCommandModule({ name: "buy", execute, hooks: { before: gate("module") } });
        const client = createClient();
        client.globals.hooks = { before: gate("shared"), prefix: { before: gate("prefix") } };
        module.inject(client);

        await module.run(createMessage("!buy"), "!", "buy");
        expect(calls).toEqual(["shared", "prefix", "module"]);

        calls.length = 0;
        client.globals.hooks.before = gate("shared", false);
        await module.run(createMessage("!buy"), "!", "buy");
        expect(calls).toEqual(["shared"]);
        expect(execute).toHaveBeenCalledOnce();
    });

    it("honours a shared before on the direct dispatch path", async () => {
        const execute = vi.fn();
        const module = new PrefixCommandModule({ name: "buy", execute });
        const client = createClient();
        client.globals.app.commandLogging = false;
        client.globals.hooks = { before: () => false };
        module.inject(client);

        await module.dispatch(createMessage("!buy"), "!", "buy");
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(["onBlocked", "onError"] as const)(
        "resolves %s as module, then prefix, then shared, then the default",
        async hook => {
            const calls: string[] = [];
            const record = (name: string) => () => void calls.push(name);
            const scopes = { module: {}, prefix: {}, shared: {} } as Record<
                "module" | "prefix" | "shared",
                Record<string, unknown>
            >;
            const client = createClient();
            client.globals.hooks = scopes.shared as GlobalCommandHooks;
            scopes.shared.prefix = scopes.prefix;
            const message = createMessage("!buy");

            const run = async () => {
                const module = new PrefixCommandModule({
                    name: "buy",
                    access: hook === "onBlocked" ? { users: ["other"] } : undefined,
                    hooks: scopes.module,
                    execute: () => {
                        throw new Error("boom");
                    }
                });
                module.inject(client);
                await module.run(message, "!", "buy");
            };

            for (const scope of ["module", "prefix", "shared"] as const) scopes[scope][hook] = record(scope);
            await run();
            delete scopes.module[hook];
            await run();
            delete scopes.prefix[hook];
            await run();
            expect(calls).toEqual(["module", "prefix", "shared"]);
            expect(message.reply).not.toHaveBeenCalled();

            delete scopes.shared[hook];
            await run();
            expect(message.reply).toHaveBeenCalledOnce();
        }
    );
});

describe("PrefixCommandModule default replies", () => {
    function run(options: Partial<ConstructorParameters<typeof PrefixCommandModule>[0]>, content = "!buy") {
        const module = new PrefixCommandModule({ name: "buy", execute: () => {}, ...options } as never);
        const client = createClient();
        module.inject(client);
        const message = createMessage(content);
        return { client, message, done: module.run(message, "!", "buy") };
    }

    it.each([
        ["no access grant", { access: { users: ["other"] } }, "You don't have permission to use this command."],
        ["guildOnly outside a guild", { guildOnly: true }, "This command can only be used in a server."]
    ])("replies without pings for %s", async (_name, options, content) => {
        const { message, done } = run(options);
        await done;
        expect(message.reply).toHaveBeenCalledExactlyOnceWith({
            content,
            allowedMentions: { parse: [], repliedUser: false }
        });
    });

    it("replies to an unmatched subcommand with the configured path text", async () => {
        const { message, done } = run({ execute: undefined, subcommands: { frame: { execute: () => {} } } }, "!buy nope");
        await done;
        expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: "Subcommand 'nope' was not found." }));
    });

    it("stays silent for a bot invoker, null messages, and environment blocks", async () => {
        const bot = createMessage("!buy");
        Object.assign(bot.author, { bot: true });
        const module = new PrefixCommandModule({ name: "buy", execute: () => {}, access: { users: ["other"] } });
        module.inject(createClient());
        await module.run(bot, "!", "buy");
        expect(bot.reply).not.toHaveBeenCalled();

        applyUxConfig({ command: { noAccess: null } });
        const silenced = run({ access: { users: ["other"] } });
        await silenced.done;
        expect(silenced.message.reply).not.toHaveBeenCalled();

        const module2 = new PrefixCommandModule({ name: "buy", environment: "production", execute: () => {} });
        const client = createClient();
        Object.assign(client, { $devMode: true });
        module2.inject(client);
        const message = createMessage("!buy");
        await module2.run(message, "!", "buy");
        expect(message.reply).not.toHaveBeenCalled();
    });

    it("logs an error and also replies, without a failed reply escaping dispatch", async () => {
        const error = new Error("boom");
        const module = new PrefixCommandModule({
            name: "buy",
            execute: () => {
                throw error;
            }
        });
        const client = createClient();
        client.globals.app.commandLogging = false;
        module.inject(client);
        const message = createMessage("!buy");
        vi.mocked(message.reply).mockRejectedValue(new Error("Missing Permissions"));

        await expect(module.dispatch(message, "!", "buy")).resolves.toBe(true);
        expect(client.logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("buy"), error);
        expect(message.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: "Something went wrong while running this command." })
        );
    });
});

describe("guildOnly narrowing", () => {
    it("narrows ctx.message to Message<true>, on the command and on one subcommand", () => {
        new PrefixCommandModule({
            name: "buy",
            guildOnly: true,
            execute(ctx) {
                const guildId: string = ctx.message.guildId;
                return guildId;
            },
            subcommands: {
                frame: {
                    execute(ctx) {
                        const guildId: string = ctx.message.guildId;
                        return guildId;
                    }
                }
            }
        });
        new PrefixCommandModule({
            name: "buy",
            execute(ctx) {
                // @ts-expect-error Without guildOnly the message may be in a DM.
                const guildId: string = ctx.message.guildId;
                return guildId;
            },
            subcommands: {
                frame: {
                    guildOnly: true,
                    execute(ctx) {
                        const guildId: string = ctx.message.guildId;
                        return guildId;
                    }
                }
            }
        });
    });
});

describe("shared hook typing", () => {
    it("exposes shared fields and narrows by source", () => {
        const hooks: GlobalCommandHooks = {
            before(ctx) {
                const shared: [string, string, boolean] = [ctx.user.id, ctx.module.name, ctx.client.isReady()];
                if ("message" in ctx) return Boolean(ctx.message.content && shared);
                return ctx.interaction.isCommand();
            }
        };
        expect(hooks.before).toBeDefined();
    });
});

describe("before typing", () => {
    it("rejects a before with a path that returns nothing", () => {
        new PrefixCommandModule({
            name: "buy",
            execute() {},
            hooks: {
                // @ts-expect-error A missed path returns undefined.
                async before(ctx) {
                    if (ctx.user.bot) return true;
                }
            }
        });
    });
});
