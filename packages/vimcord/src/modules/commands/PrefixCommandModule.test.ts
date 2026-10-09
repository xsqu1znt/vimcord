import type { Message } from "discord.js";
import type { CommandModuleContext, CommandModuleHookContext, CommandModuleType } from "@/abstracts/index.js";
import type { Vimcord } from "@/client/index.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppGlobals } from "@/client/globals.js";
import { defineGlobalCommandHooks, getGlobalCommandHooks } from "@/commands/commandHooks.js";
import { PrefixCommandModule } from "./PrefixCommandModule.js";

function createClient() {
    return {
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), options: { verbose: false } },
        globals: { app: defaultAppGlobals(), staff: {}, hooks: undefined }
    } as unknown as Vimcord;
}

function createMessage(content: string) {
    return {
        content,
        author: { id: "user", bot: false },
        guildId: null,
        guild: null,
        member: null,
        channel: {}
    } as unknown as Message;
}

afterEach(() => {
    delete getGlobalCommandHooks().prefix;
});

describe("PrefixCommandModule subcommands", () => {
    it.each(["frame", "FRAME", "FrAmE", "f", "F"])("routes %s with remaining content and canonical name", async token => {
        const handler = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => ({
            name: ctx.subcommand,
            content: ctx.messageContent,
            args: ctx.splitContent(),
            lower: ctx.splitContent({ lowercase: true }),
            upper: ctx.splitContent({ uppercase: true }),
            commas: ctx.splitContent({ separator: "," })
        }));
        const execute = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            subcommands: { Frame: { aliases: ["f"], description: "Buy a frame", handler } },
            execute
        });
        module.inject(createClient());
        const message = createMessage(`!  buy  ${token}\t  Red,Blue  2  `);

        expect(await module.run(message, "!", "buy")).toEqual({
            name: "frame",
            content: "Red,Blue  2",
            args: ["Red,Blue", "2"],
            lower: ["red,blue", "2"],
            upper: ["RED,BLUE", "2"],
            commas: ["Red", "Blue  2"]
        });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0]![0].message).toBe(message);
        expect(execute).not.toHaveBeenCalled();
        expect(module.subcommands.get("frame")).toMatchObject({ description: "Buy a frame", aliases: ["f"] });
    });

    it.each(["", "unknown Keep CASE"])("falls back with original args for '%s'", async content => {
        const execute = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => [
            ctx.subcommand,
            ctx.messageContent,
            ctx.splitContent()
        ]);
        const handler = vi.fn();
        const module = new PrefixCommandModule({ name: "buy", subcommands: { frame: { handler } }, execute });
        module.inject(createClient());

        expect(await module.run(createMessage(`!buy ${content}`), "!", "buy")).toEqual([
            null,
            content,
            content ? ["unknown", "Keep", "CASE"] : []
        ]);
        expect(execute).toHaveBeenCalledOnce();
        expect(handler).not.toHaveBeenCalled();
    });

    it("supports subcommands-only modules and does nothing for an unmatched token", async () => {
        const handler = vi.fn((ctx: CommandModuleContext<CommandModuleType.Prefix>) => ctx.splitContent());
        const module = new PrefixCommandModule({ name: "buy", subcommands: { frame: { handler } } });
        module.inject(createClient());
        expect(await module.run(createMessage("!buy frame"), "!", "buy")).toEqual([]);
        expect(await module.run(createMessage("!buy unknown"), "!", "buy")).toBeUndefined();
        expect(await module.run(createMessage("!buy"), "!", "buy")).toBeUndefined();
        expect(handler).toHaveBeenCalledOnce();
    });

    it("runs global hooks and parent conditions once with the matched subcommand", async () => {
        const preExecute = vi.fn(async (ctx: CommandModuleHookContext<CommandModuleType.Prefix>, next: () => void) => {
            expect(ctx.subcommand).toBe("frame");
            expect(ctx.splitContent()).toEqual(["Red"]);
            next();
        });
        const postExecute = vi.fn(async () => {});
        defineGlobalCommandHooks({ prefix: { preExecute, postExecute } });
        const condition = vi.fn(() => ({ passed: true as const }));
        const handler = vi.fn(() => "bought");
        const module = new PrefixCommandModule({
            name: "buy",
            conditions: [condition],
            subcommands: { frame: { handler } }
        });
        module.inject(createClient());

        expect(await module.run(createMessage("!buy frame Red"), "!", "buy")).toBe("bought");
        expect(condition).toHaveBeenCalledOnce();
        expect(preExecute).toHaveBeenCalledOnce();
        expect(postExecute).toHaveBeenCalledOnce();
        expect(postExecute).toHaveBeenCalledWith(expect.objectContaining({ subcommand: "frame" }), "bought");
    });

    it("does not bypass parent permissions or a preExecute halt", async () => {
        const handler = vi.fn();
        const module = new PrefixCommandModule({
            name: "buy",
            permissions: { users: ["other"] },
            subcommands: { frame: { handler } }
        });
        module.inject(createClient());
        expect((await module.runWithResult(createMessage("!buy frame"), "!", "buy")).executed).toBe(false);

        const halted = new PrefixCommandModule({
            name: "buy",
            hooks: { preExecute: async () => {} },
            subcommands: { frame: { handler } }
        });
        halted.inject(createClient());
        expect((await halted.runWithResult(createMessage("!buy frame"), "!", "buy")).executed).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it("rejects ambiguous subcommand aliases at construction", () => {
        expect(
            () =>
                new PrefixCommandModule({
                    name: "buy",
                    subcommands: {
                        frame: { aliases: ["EFFECT"], handler: () => {} },
                        effect: { handler: () => {} }
                    }
                })
        ).toThrow(/duplicate/);
    });
});
