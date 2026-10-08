import type { InteractionBasedSendHandler } from "./dynaSend.js";

import EventEmitter from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BetterCollector } from "./betterCollector.js";
import { ResolveAction } from "./shared.js";

vi.mock("./interactionRouter.js", () => ({
    createRoutedMessageCollector: (
        message: { createMessageComponentCollector(options: unknown): unknown },
        options: unknown
    ) => message.createMessageComponentCollector(options)
}));

function createMessage() {
    const collector = Object.assign(new EventEmitter(), { stop: vi.fn() });
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

describe("BetterCollector participant filtering", () => {
    it("runs global and ID listeners in registration order", async () => {
        const { message, collector } = createMessage();
        const bc = new BetterCollector(message, { timeout: 1000 });
        const calls: string[] = [];
        bc.on("btn", () => calls.push("id"));
        bc.on(() => calls.push("global"));

        collector.emit("collect", createInteraction("userA", "btn"));
        await new Promise(resolve => setImmediate(resolve));

        expect(calls).toEqual(["id", "global"]);
    });

    it("applies a per-listener restriction even though the collector has no global participants", async () => {
        const { message, collector, getFilter } = createMessage();
        const bc = new BetterCollector(message, { timeout: 1000 });

        const globalListener = vi.fn();
        const restrictedListener = vi.fn();
        bc.on("btn", globalListener);
        bc.on("btn", restrictedListener, { participants: ["userA"] });

        const filter = getFilter();
        const interactionB = createInteraction("userB", "btn");

        // The old bug: an empty global participant list short-circuited and let every listener through.
        expect(await filter(interactionB)).toBe(true);
        collector.emit("collect", interactionB);
        await new Promise(resolve => setImmediate(resolve));

        expect(globalListener).toHaveBeenCalledTimes(1);
        expect(restrictedListener).not.toHaveBeenCalled();
    });

    it("rejects at the Discord.js filter level when no listener allows the participant, before any listener runs", async () => {
        const { message, getFilter } = createMessage();
        const bc = new BetterCollector(message, { timeout: 1000 });

        const restrictedListener = vi.fn();
        bc.on("btn", restrictedListener, { participants: ["userA"] });

        const filter = getFilter();
        const interactionB = createInteraction("userB", "btn");

        expect(await filter(interactionB)).toBe(false);
        expect(interactionB.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: "Ephemeral" }));
        expect(restrictedListener).not.toHaveBeenCalled();
    });

    it("releases the user lock even after a listener throws", async () => {
        const { message, collector, getFilter } = createMessage();
        const bc = new BetterCollector(message, { timeout: 1000, userLock: true });

        bc.on("btn", () => {
            throw new Error("boom");
        });

        const filter = getFilter();
        const interaction = createInteraction("userA", "btn");

        expect(await filter(interaction)).toBe(true);
        collector.emit("collect", interaction);
        await new Promise(resolve => setImmediate(resolve));

        // A second click from the same user must not still be treated as locked.
        expect(await filter(createInteraction("userA", "btn"))).toBe(true);
    });
});

describe("BetterCollector onResolve", () => {
    it("waits for end listeners before delivering a combined completion payload", async () => {
        const { message, collector } = createMessage();
        message.edit = vi.fn().mockResolvedValue(message);
        const collected = [createInteraction("user", "btn")];
        let ended = false;
        const onResolve = vi.fn(async context => {
            expect(ended).toBe(true);
            expect(context).toEqual({ message, collected, reason: "manual" });
            return { action: ResolveAction.DisableComponents, content: "Done" };
        });
        const bc = new BetterCollector(message, { timeout: 1000, onResolve });
        bc.onEnd(async () => {
            await Promise.resolve();
            ended = true;
        });
        collector.emit("end", collected, "manual");
        await new Promise(resolve => setImmediate(resolve));
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
        interaction: { webhook: { editMessage } } as unknown as InteractionBasedSendHandler,
        onResolve: () => ({ action: ResolveAction.ClearComponents, content: "Done" })
    });
    collector.emit("end", [], "time");
    await new Promise(resolve => setImmediate(resolve));
    expect(editMessage).toHaveBeenCalledWith("ephemeral", expect.objectContaining({ content: "Done" }));
});
