import type { InteractionBasedSendHandler } from "./dynaSend.js";

import EventEmitter from "node:events";
import { Collection, ComponentType } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetterCollector } from "./betterCollector.js";
import { defineGlobalUxConfig } from "./uxConfig.js";

vi.mock("./interactionRouter.js", () => ({
    createRoutedMessageCollector: (
        message: { createMessageComponentCollector(options: unknown): unknown },
        options: unknown
    ) => message.createMessageComponentCollector(options)
}));

function createMessage() {
    const collector = Object.assign(new EventEmitter(), {
        stop: vi.fn(),
        collected: new Collection(),
        users: new Collection()
    });
    let filter: (interaction: any) => boolean | Promise<boolean>;
    const message: any = {
        editable: true,
        components: [],
        createMessageComponentCollector: (opts: any) => {
            filter = opts.filter;
            return collector;
        }
    };
    return { message, collector, getFilter: () => filter };
}

function createInteraction(userId: string, customId: string) {
    return {
        user: { id: userId },
        customId,
        reply: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined)
    };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => {
    vi.restoreAllMocks();
});

describe("BetterCollector handlers", () => {
    function open() {
        const parts = createMessage();
        return { ...parts, bc: new BetterCollector(parts.message, { timeout: 1000, participants: "anyone" }) };
    }

    it("runs only the specific handler when both it and a wildcard exist, whatever the registration order", async () => {
        const { bc, collector } = open();
        const specific = vi.fn();
        const wildcard = vi.fn();
        bc.on(wildcard).on("btn", specific);
        const i = createInteraction("a", "btn");
        collector.emit("collect", i);
        await settle();
        expect(specific).toHaveBeenCalledExactlyOnceWith(i);
        expect(wildcard).not.toHaveBeenCalled();
        expect(i.deferUpdate).not.toHaveBeenCalled();
    });

    it("falls back to the wildcard for IDs with no handler, without auto-deferring", async () => {
        const { bc, collector } = open();
        const specific = vi.fn();
        const wildcard = vi.fn();
        bc.on("btn", specific).on(wildcard);
        const i = createInteraction("a", "other");
        collector.emit("collect", i);
        await settle();
        expect(wildcard).toHaveBeenCalledExactlyOnceWith(i);
        expect(specific).not.toHaveBeenCalled();
        expect(i.deferUpdate).not.toHaveBeenCalled();
    });

    it("auto-defers a click with no handler and no wildcard", async () => {
        const { bc, collector } = open();
        bc.on("btn", vi.fn());
        const i = createInteraction("a", "other");
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
    });

    it("throws at registration on a duplicate custom ID, naming it", () => {
        const { bc } = open();
        bc.on("btn_trade:confirm", vi.fn());
        expect(() => bc.on("btn_trade:confirm", vi.fn())).toThrow(/btn_trade:confirm/);
        expect(() => bc.on("other", vi.fn())).not.toThrow();
    });

    it("throws at registration on a second wildcard", () => {
        const { bc } = open();
        bc.on(vi.fn());
        expect(() => bc.on(vi.fn())).toThrow(/wildcard/);
    });

    it("logs a handler's error instead of letting it escape", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { bc, collector } = open();
        const failure = new Error("boom");
        bc.on("btn", () => {
            throw failure;
        });
        collector.emit("collect", createInteraction("a", "btn"));
        await settle();
        expect(error).toHaveBeenCalledWith("[BetterCollector] Listener error:", failure);
    });
});

describe("BetterCollector onCollect", () => {
    function open() {
        const parts = createMessage();
        return { ...parts, bc: new BetterCollector(parts.message, { timeout: 1000, participants: "anyone" }) };
    }

    it("awaits observers in order before the handler, ignoring what they return", async () => {
        const { bc, collector } = open();
        const calls: string[] = [];
        bc.onCollect(async () => {
            await settle();
            calls.push("first");
            return false;
        })
            .onCollect(() => {
                calls.push("second");
            })
            .on("btn", () => {
                calls.push("handler");
            });
        collector.emit("collect", createInteraction("a", "btn"));
        await settle();
        await settle();
        expect(calls).toEqual(["first", "second", "handler"]);
    });

    it("logs an observer's error and still runs the later observers and the handler", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { bc, collector } = open();
        const failure = new Error("boom");
        const later = vi.fn();
        const handler = vi.fn();
        bc.onCollect(() => {
            throw failure;
        })
            .onCollect(later)
            .on("btn", handler);
        collector.emit("collect", createInteraction("a", "btn"));
        await settle();
        expect(error).toHaveBeenCalledWith("[BetterCollector] Listener error:", failure);
        expect(later).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledOnce();
    });

    it("fires for a click with no handler, with the automatic deferUpdate following", async () => {
        const { bc, collector } = open();
        const i = createInteraction("a", "unhandled");
        const observer = vi.fn(() => expect(i.deferUpdate).not.toHaveBeenCalled());
        bc.onCollect(observer);
        collector.emit("collect", i);
        await settle();
        expect(observer).toHaveBeenCalledOnce();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
    });
});

describe("BetterCollector rejection", () => {
    it("rejects non-participants on every custom ID, and reads a user or member by ID", async () => {
        const { message, getFilter } = createMessage();
        new BetterCollector(message, { participants: ["a", { id: "b" } as never] });
        const outsider = createInteraction("c", "no-handler");
        expect(await getFilter()(outsider)).toBe(false);
        expect(outsider.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: "Ephemeral" }));
        expect(await getFilter()(createInteraction("a", "btn"))).toBe(true);
        expect(await getFilter()(createInteraction("b", "btn"))).toBe(true);
    });

    it("leaves a user-supplied empty participants list open", async () => {
        const { message, getFilter } = createMessage();
        new BetterCollector(message, { participants: [] });
        expect(await getFilter()(createInteraction("anyone", "btn"))).toBe(true);
    });

    it("acknowledges silently when the not-a-participant message is configured off", async () => {
        defineGlobalUxConfig({ collector: { notAParticipantMessage: null } });
        const { message, getFilter } = createMessage();
        new BetterCollector(message, { participants: ["a"] });
        const outsider = createInteraction("c", "btn");
        expect(await getFilter()(outsider)).toBe(false);
        expect(outsider.reply).not.toHaveBeenCalled();
        expect(outsider.deferUpdate).toHaveBeenCalledOnce();
        defineGlobalUxConfig({ collector: { notAParticipantMessage: "You are not allowed to use this." } });
    });

    it("doesn't fire onCollect for rejected clicks, because they never reach the collector's collect event", async () => {
        const { message, getFilter } = createMessage();
        const observer = vi.fn();
        new BetterCollector(message, { participants: ["a"], clickLock: true }).onCollect(observer);
        expect(await getFilter()(createInteraction("c", "btn"))).toBe(false);
        expect(await getFilter()(createInteraction("a", "btn"))).toBe(true);
        expect(await getFilter()(createInteraction("a", "btn"))).toBe(false);
        expect(observer).not.toHaveBeenCalled();
    });
});

describe("BetterCollector clickLock", () => {
    it("rejects a second click with the config's message until the first finishes, and only for that user", async () => {
        const { message, collector, getFilter } = createMessage();
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        new BetterCollector(message, { participants: "anyone", clickLock: true }).on("btn", () => gate);
        const first = createInteraction("a", "btn");
        expect(await getFilter()(first)).toBe(true);
        collector.emit("collect", first);

        const second = createInteraction("a", "btn");
        expect(await getFilter()(second)).toBe(false);
        expect(second.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: "Please wait, your previous action is still processing." })
        );
        expect(await getFilter()(createInteraction("b", "btn"))).toBe(true);

        release();
        await settle();
        expect(await getFilter()(createInteraction("a", "btn"))).toBe(true);
    });

    it("releases the lock even after a handler throws", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { message, collector, getFilter } = createMessage();
        const bc = new BetterCollector(message, { timeout: 1000, participants: "anyone", clickLock: true });
        bc.on("btn", () => {
            throw new Error("boom");
        });
        const interaction = createInteraction("userA", "btn");
        expect(await getFilter()(interaction)).toBe(true);
        collector.emit("collect", interaction);
        await settle();
        expect(await getFilter()(createInteraction("userA", "btn"))).toBe(true);
    });
});

describe("BetterCollector onResolve", () => {
    it("waits for end listeners, which get only the reason, before delivering a combined payload", async () => {
        const { message, collector } = createMessage();
        message.edit = vi.fn().mockResolvedValue(message);
        let ended = false;
        const onResolve = vi.fn(async context => {
            expect(ended).toBe(true);
            expect(context).toEqual({ message, reason: "manual" });
            return { action: "disable" as const, content: "Done" };
        });
        const onEnd = vi.fn(async () => {
            await Promise.resolve();
            ended = true;
        });
        new BetterCollector(message, { timeout: 1000, participants: "anyone", onResolve }).onEnd(onEnd);
        collector.emit("end", new Collection(), "manual");
        await settle();
        expect(onEnd).toHaveBeenCalledExactlyOnceWith("manual");
        expect(onResolve).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "Done" }));
    });
});

it("delivers an ephemeral collector's final payload through its sending interaction", async () => {
    const { message, collector } = createMessage();
    Object.assign(message, { id: "ephemeral", editable: false });
    const editMessage = vi.fn().mockResolvedValue(message);
    new BetterCollector(message, {
        timeout: 1000,
        participants: "anyone",
        interaction: { webhook: { editMessage } } as unknown as InteractionBasedSendHandler,
        onResolve: () => ({ action: "clear" as const, content: "Done" })
    });
    collector.emit("end", [], "time");
    await settle();
    expect(editMessage).toHaveBeenCalledWith("ephemeral", expect.objectContaining({ content: "Done" }));
});

describe("BetterCollector defaults", () => {
    const row = {
        toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "go" }] })
    };

    it("disables components on end, idles for the configured default, and retains no history", async () => {
        const { message, collector } = createMessage();
        message.components = [row];
        message.edit = vi.fn().mockResolvedValue(message);
        const create = vi.spyOn(message, "createMessageComponentCollector");
        new BetterCollector(message, { participants: "anyone" });
        expect(create.mock.calls[0]![0]).toMatchObject({ idle: 60_000, time: undefined });
        collector.collected.set("1", {});
        expect(collector.collected.get("1")).toBeUndefined();
        collector.users.set("1", {});
        expect(collector.users.get("1")).toBeUndefined();
        collector.emit("end", [], "idle");
        await settle();
        expect(message.edit.mock.calls[0]![0].components[0].components[0].disabled).toBe(true);
    });

    it.each(["messageDelete", "channelDelete", "threadDelete", "guildDelete", "messageDeleteBulk"])(
        "doesn't edit a message that ended with %s, but still runs the callback",
        async reason => {
            const { message, collector } = createMessage();
            message.components = [row];
            message.edit = vi.fn();
            const onResolve = vi.fn(() => "disable" as const);
            new BetterCollector(message, { participants: "anyone", onResolve });
            collector.emit("end", [], reason);
            await settle();
            expect(onResolve).toHaveBeenCalledOnce();
            expect(message.edit).not.toHaveBeenCalled();
        }
    );

    it("rejects both idle and timeout", () => {
        const { message } = createMessage();
        // @ts-expect-error idle and timeout are mutually exclusive.
        expect(() => new BetterCollector(message, { participants: "anyone", idle: 1, timeout: 1 })).toThrow(/Only one of/);
    });
});
