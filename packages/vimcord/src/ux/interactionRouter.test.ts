import type { MessageComponentInteraction, ModalSubmitInteraction } from "discord.js";

import {
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    Collection,
    ComponentType,
    Events,
    InteractionCollector,
    InteractionType,
    Message
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetterCollector } from "./betterCollector.js";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";
import * as routing from "./interactionRouter.js";
import { Paginator } from "./paginator.js";
import { promptMessage } from "./prompt.js";
import { ResolveAction } from "./shared.js";

vi.mock("./dynaSend.js", async original => ({ ...(await original<typeof import("./dynaSend.js")>()), dynaSend: vi.fn() }));

const LEGACY_CREATE = Message.prototype.createMessageComponentCollector;
const ROUTED_CREATE = routing.createRoutedMessageCollector;
const ROUTED_MODAL = routing.awaitRoutedModal;
const clients: Client[] = [];
const collectors: { stop(reason?: string): void }[] = [];
let nextId = 0;

function makeClient() {
    const client = new Client({ intents: [] });
    clients.push(client);
    return client;
}

function makeMessage(client = makeClient(), id = String(nextId++)) {
    const TestMessage = Message as unknown as new (client: Client, data: object) => Message<true>;
    const message = new TestMessage(client, {
        id,
        channel_id: "channel",
        guild_id: "guild",
        content: "page",
        type: 0,
        author: { id: "bot", username: "bot", discriminator: "0", avatar: null },
        timestamp: new Date().toISOString(),
        components: [{ type: 1, components: [{ type: 2, custom_id: "btn", label: "Button", style: 1 }] }]
    });
    vi.spyOn(message, "editable", "get").mockReturnValue(true);
    vi.spyOn(message, "deletable", "get").mockReturnValue(true);
    vi.spyOn(message, "edit").mockResolvedValue(message);
    vi.spyOn(message, "delete").mockResolvedValue(message);
    return message;
}

function click(message: Message, customId = "btn", userId = "a", componentType = ComponentType.Button) {
    return {
        id: String(nextId++),
        message,
        channelId: message.channelId,
        guildId: message.guildId,
        type: InteractionType.MessageComponent,
        componentType,
        customId,
        user: { id: userId },
        replied: false,
        deferred: false,
        values: [],
        reply: vi.fn(async function (this: { replied: boolean }) {
            this.replied = true;
        }),
        deferReply: vi.fn(async function (this: { deferred: boolean }) {
            this.deferred = true;
        }),
        deferUpdate: vi.fn(async function (this: { deferred: boolean }) {
            this.deferred = true;
        }),
        update: vi.fn(async function (this: { replied: boolean }) {
            this.replied = true;
            return { resource: { message } };
        }),
        followUp: vi.fn().mockResolvedValue(undefined),
        isStringSelectMenu: () => componentType === ComponentType.StringSelect
    };
}

async function settle() {
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
}

function better(message: Message, options: ConstructorParameters<typeof BetterCollector>[1] = { timeout: 1000 }) {
    const collector = new BetterCollector(message, options);
    collectors.push(collector);
    return collector;
}

afterEach(async () => {
    for (const collector of collectors.splice(0)) collector.stop();
    for (const client of clients.splice(0)) await client.destroy();
    vi.restoreAllMocks();
    vi.mocked(dynaSend).mockReset();
});

describe.each(["legacy", "routed"] as const)("installed Discord.js parity: %s", backend => {
    beforeEach(() => {
        if (backend === "routed") {
            vi.spyOn(Message.prototype, "createMessageComponentCollector").mockImplementation(function (
                this: Message,
                options
            ) {
                return ROUTED_CREATE(this, options ?? {}) as never;
            });
        } else {
            vi.spyOn(routing, "createRoutedMessageCollector").mockImplementation(
                (message, options) => LEGACY_CREATE.call(message, options) as never
            );
            vi.spyOn(routing, "awaitRoutedModal").mockImplementation(
                (client, customId, time) =>
                    ButtonInteraction.prototype.awaitModalSubmit.call(
                        { client },
                        { filter: i => i.customId === customId, time }
                    ) as Promise<ModalSubmitInteraction>
            );
        }
    });

    it("preserves wildcard/ID order, per-listener participants and deferral, and unknown-ID history", async () => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, participants: ["a"], defer: { update: true } });
        const calls: string[] = [];
        c.on("btn", () => calls.push("restricted"), { participants: ["b"], defer: { flags: "Ephemeral" } });
        c.on(() => calls.push("wildcard"));
        c.on("btn", () => calls.push("id"));
        const rejected = click(message, "btn", "c");
        message.client.emit(Events.InteractionCreate, rejected as never);
        await settle();
        expect(rejected.reply).toHaveBeenCalledOnce();
        const accepted = click(message, "btn", "b");
        message.client.emit(Events.InteractionCreate, accepted as never);
        await settle();
        expect(calls).toEqual(["restricted"]);
        expect(accepted.deferReply).toHaveBeenCalledWith({ flags: "Ephemeral" });
        message.client.emit(Events.InteractionCreate, click(message) as never);
        await settle();
        expect(calls).toEqual(["restricted", "wildcard", "id"]);
        const end = vi.fn();
        c.onEnd(end);
        c.stop("done");
        await settle();
        expect(end.mock.calls[0]?.[0]).toHaveLength(2);
        expect(end.mock.calls[0]?.[1]).toBe("done");
    });

    it.each([
        [{ max: 2 }, "limit"],
        [{ maxComponents: 2 }, "componentLimit"],
        [{ maxUsers: 2 }, "userLimit"]
    ] as const)("preserves %o limits and end history", async (limits, reason) => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, ...limits });
        const end = vi.fn();
        c.on("btn", () => {}).onEnd(end);
        for (const user of ["a", "b"]) {
            message.client.emit(Events.InteractionCreate, click(message, "btn", user) as never);
            await settle();
        }
        expect(end).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ customId: "btn" })]), reason);
        expect(end.mock.calls[0]?.[0]).toHaveLength(2);
    });

    it("unknown IDs are collected, auto-deferred and count toward limits", async () => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, max: 1, participants: ["a"] });
        c.on("known", () => {});
        const end = vi.fn();
        c.onEnd(end);
        const i = click(message, "unknown", "outsider");
        message.client.emit(Events.InteractionCreate, i as never);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        expect(end).toHaveBeenCalledWith([i], "limit");
    });

    it("locks before collection, ignores rejected clicks for limits, and releases after listeners", async () => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, max: 2, userLock: true });
        let release!: () => void;
        const gate = new Promise<void>(r => (release = r));
        const listener = vi.fn(() => gate);
        const end = vi.fn();
        c.on("btn", listener).onEnd(end);
        const a = click(message);
        const b = click(message);
        message.client.emit(Events.InteractionCreate, a as never);
        message.client.emit(Events.InteractionCreate, b as never);
        await settle();
        expect(listener).toHaveBeenCalledOnce();
        expect(b.reply).toHaveBeenCalledOnce();
        expect(end).not.toHaveBeenCalled();
        release();
        await settle();
        message.client.emit(Events.InteractionCreate, click(message) as never);
        await settle();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(end.mock.calls[0]?.[0]).toHaveLength(2);
    });

    it("routes overlapping sessions without reordering and checks component/channel/guild boundaries", async () => {
        const message = makeMessage();
        const order: string[] = [];
        const a = better(message, { timeout: 1000, type: ComponentType.Button });
        const b = better(message);
        a.on("btn", () => order.push("a"));
        b.on("btn", () => order.push("b"));
        for (const i of [
            Object.assign(click(message), { channelId: "elsewhere" }),
            Object.assign(click(message), { guildId: "elsewhere" })
        ]) {
            message.client.emit(Events.InteractionCreate, i as never);
        }
        await settle();
        expect(order).toEqual([]);
        message.client.emit(Events.InteractionCreate, click(message) as never);
        await settle();
        expect(order).toEqual(["a", "b"]);
        message.client.emit(Events.InteractionCreate, click(message, "btn", "a", ComponentType.StringSelect) as never);
        await settle();
        expect(order).toEqual(["a", "b", "b"]);
    });

    it.each(["messageDelete", "messageDeleteBulk", "channelDelete", "threadDelete", "guildDelete", "parentDelete"])(
        "preserves %s ending and removes installed listeners",
        async event => {
            const message = makeMessage();
            const baseline = message.client.listenerCount(Events.InteractionCreate);
            const c = better(message);
            const end = vi.fn();
            c.onEnd(end);
            if (event === "messageDeleteBulk")
                message.client.emit(Events.MessageBulkDelete, new Collection([[message.id, message]]) as never, {} as never);
            else if (event === "parentDelete")
                message.client.emit(Events.ChannelDelete, {
                    id: "parent",
                    threads: { cache: new Map([[message.channelId, true]]) }
                } as never);
            else
                message.client.emit(event, {
                    id:
                        event === "messageDelete"
                            ? message.id
                            : event === "guildDelete"
                              ? message.guildId
                              : message.channelId
                } as never);
            await settle();
            expect(end).toHaveBeenCalledWith(
                [],
                event === "messageDeleteBulk" ? "messageDelete" : event === "parentDelete" ? "channelDelete" : event
            );
            expect(message.client.listenerCount(Events.InteractionCreate)).toBe(baseline);
        }
    );

    it.each(["time", "idle"] as const)("preserves %s timers and ignores rejected participants for idle", async reason => {
        const message = makeMessage();
        const c = better(message, reason === "time" ? { timeout: 30 } : { idle: 30 });
        c.on("btn", () => {}, { participants: ["a"] });
        const end = vi.fn();
        c.onEnd(end);
        await new Promise(r => setTimeout(r, 15));
        message.client.emit(Events.InteractionCreate, click(message, "btn", "b") as never);
        await new Promise(r => setTimeout(r, 35));
        expect(end).toHaveBeenCalledWith([], reason);
        expect(message.client.listenerCount(Events.InteractionCreate)).toBe(0);
    });

    it("resets idle on an accepted interaction", async () => {
        const message = makeMessage();
        const c = better(message, { idle: 80 });
        c.on("btn", () => {});
        const end = vi.fn();
        c.onEnd(end);
        await new Promise(r => setTimeout(r, 50));
        message.client.emit(Events.InteractionCreate, click(message) as never);
        await settle();
        await new Promise(r => setTimeout(r, 50));
        expect(end).not.toHaveBeenCalled();
        await new Promise(r => setTimeout(r, 50));
        expect(end.mock.calls[0]?.[1]).toBe("idle");
    });

    it("matches the installed collector's in-flight manual-stop race and concurrent max race", async () => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, max: 1 });
        const listener = vi.fn();
        const end = vi.fn();
        c.on("btn", listener).onEnd(end);
        message.client.emit(Events.InteractionCreate, click(message) as never);
        message.client.emit(Events.InteractionCreate, click(message, "btn", "b") as never);
        c.stop("manual");
        await settle();
        // Discord.js already-started handleCollect calls continue after stop and can overshoot max.
        expect(end).toHaveBeenCalledWith([], "manual");
        expect(listener).toHaveBeenCalledTimes(2);
        expect(message.client.listenerCount(Events.InteractionCreate)).toBe(0);
    });

    it.each(["confirmed", "rejected", "custom", "timeout"] as const)("preserves promptMessage %s", async status => {
        const message = makeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);
        const promise = promptMessage(message, {
            timeout: 1000,
            onResolve: ResolveAction.DoNothing,
            resolveOnAdditionalButton: true,
            additionalButtons: [new ButtonBuilder().setCustomId("custom").setLabel("Custom").setStyle(ButtonStyle.Primary)],
            onCollector: c => {
                collectors.push(c);
                if (status === "timeout") c.stop();
            }
        });
        await settle();
        if (status !== "timeout")
            message.client.emit(
                Events.InteractionCreate,
                click(
                    message,
                    status === "confirmed" ? "prompt:confirm" : status === "rejected" ? "prompt:reject" : "custom"
                ) as never
            );
        const result = await promise;
        expect(result.status).toBe(status);
        expect(message.client.listenerCount(Events.InteractionCreate)).toBe(0);
    });

    it("drives paginator navigation, asynchronous collect listeners, and timeout cleanup", async () => {
        const message = makeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);
        const p = new Paginator({ pages: ["a", "b"], idle: 30, onResolve: ResolveAction.ClearComponents });
        const order: string[] = [];
        p.on("collect", async () => {
            await Promise.resolve();
            order.push("collect");
        });
        p.on("paginate", () => {
            order.push("paginate");
        });
        await p.send(message);
        message.client.emit(Events.InteractionCreate, click(message, "paginator:next") as never);
        await settle();
        expect(order).toEqual(["collect", "paginate"]);
        expect(vi.mocked(dynaSend).mock.calls.at(-1)?.[1]).toMatchObject({ content: "b" });
        await new Promise(r => setTimeout(r, 50));
        expect(message.edit).toHaveBeenCalledWith({ components: [] });
        expect(message.client.listenerCount(Events.InteractionCreate)).toBe(0);
    });

    it.each([
        [{ maxComponents: 2 }, "componentLimit"],
        [{ maxUsers: 2 }, "userLimit"],
        [{ max: 3 }, "limit"]
    ] as const)("preserves %s without retaining interactions or users when history is disabled", async (limits, reason) => {
        const message = makeMessage();
        const c = better(message, { timeout: 1000, retainHistory: false, ...limits });
        const end = vi.fn();
        c.on("btn", () => {}).onEnd(end);
        const a = click(message);
        message.client.emit(Events.InteractionCreate, a as never);
        await settle();
        message.client.emit(Events.InteractionCreate, a as never);
        await settle();
        expect(end).not.toHaveBeenCalled();
        const underlying = Reflect.get(c, "collector") as {
            collected: Collection<string, unknown>;
            users: Collection<string, unknown>;
        };
        expect([...underlying.collected.values()]).toEqual([]);
        expect([...underlying.users.values()]).toEqual([]);
        message.client.emit(Events.InteractionCreate, click(message, "btn", "b") as never);
        await settle();
        expect(end).toHaveBeenCalledWith([], reason);
    });

    it.each([false, true])(
        "rechecks mutable participants between filter and delivery (added listener: %s)",
        async addListener => {
            const message = makeMessage();
            const c = better(message);
            const participants = ["a"];
            const first = vi.fn();
            const added = vi.fn();
            c.on("btn", first, { participants });
            const i = click(message);
            const internals = c as unknown as {
                filterInteraction(i: unknown): Promise<boolean>;
                handleCollect(i: unknown): Promise<void>;
            };
            expect(await internals.filterInteraction(i)).toBe(true);
            participants[0] = "b";
            if (addListener) c.on("btn", added);
            await internals.handleCollect(i);
            expect(first).not.toHaveBeenCalled();
            expect(added).toHaveBeenCalledTimes(addListener ? 1 : 0);
        }
    );

    it("drives BetterModal deferral and timeout through the installed collector", async () => {
        const client = makeClient();
        const modal = new BetterModal();
        const submit = {
            id: String(nextId++),
            type: InteractionType.ModalSubmit,
            customId: modal.customId,
            user: { id: "a" },
            fields: {},
            deferUpdate: vi.fn().mockResolvedValue(undefined)
        };
        const pending = modal.awaitSubmit({ client } as never, { timeout: 1000, deferUpdate: true });
        client.emit(Events.InteractionCreate, submit as never);
        expect((await pending)?.interaction).toBe(submit);
        expect(submit.deferUpdate).toHaveBeenCalledOnce();
        expect(await modal.awaitSubmit({ client } as never, { timeout: 20 })).toBeNull();
        expect(client.listenerCount(Events.InteractionCreate)).toBe(0);
    });

    it("preserves modal custom-ID-only matching, overlapping waits, and timeout errors", async () => {
        const client = makeClient();
        const wait = (id: string, time: number) =>
            backend === "legacy"
                ? ButtonInteraction.prototype.awaitModalSubmit.call({ client }, { time, filter: i => i.customId === id })
                : ROUTED_MODAL(client, id, time);
        const a = wait("modal", 1000);
        const b = wait("modal", 1000);
        const timeout = expect(wait("other", 20)).rejects.toMatchObject({ code: "InteractionCollectorError" });
        client.emit(Events.InteractionCreate, {
            id: String(nextId++),
            type: InteractionType.ModalSubmit,
            customId: "modal",
            user: { id: "outsider" }
        } as never);
        expect(await a).toBe(await b);
        await timeout;
        expect(client.listenerCount(Events.InteractionCreate)).toBe(0);
    });
});

it("reduces unrelated fan-out from 1000 checks to zero and releases all router listeners", async () => {
    const client = makeClient();
    const collect = vi.spyOn(InteractionCollector.prototype, "collect");
    const legacy = Array.from({ length: 1000 }, () => LEGACY_CREATE.call(makeMessage(client), { time: 1000 }));
    client.emit(Events.InteractionCreate, click(makeMessage(client)) as never);
    await settle();
    expect(collect).toHaveBeenCalledTimes(1000);
    legacy.forEach(c => c.stop());
    collect.mockClear();
    const routed = Array.from({ length: 1000 }, () => ROUTED_CREATE(makeMessage(client), { time: 1000 }));
    expect(client.listenerCount(Events.InteractionCreate)).toBe(1);
    client.emit(Events.InteractionCreate, click(makeMessage(client)) as never);
    await settle();
    expect(collect).not.toHaveBeenCalled();
    routed.forEach(c => c.stop());
    for (const event of [
        Events.InteractionCreate,
        Events.MessageDelete,
        Events.MessageBulkDelete,
        Events.ChannelDelete,
        Events.ThreadDelete,
        Events.GuildDelete
    ])
        expect(client.listenerCount(event)).toBe(0);
});
