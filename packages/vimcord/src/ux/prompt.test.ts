import EventEmitter from "node:events";
import {
    ActionRowBuilder,
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Collection,
    ComponentType,
    Message
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynaSend } from "./dynaSend.js";
import { promptMessage } from "./prompt.js";
import { applyUxConfig } from "./uxConfig.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

vi.mock("./interactionRouter.js", () => ({
    createRoutedMessageCollector: (
        message: { createMessageComponentCollector(options: unknown): unknown },
        options: unknown
    ) => message.createMessageComponentCollector(options)
}));

function createFakeMessage() {
    const collector = Object.assign(new EventEmitter(), {
        stop: vi.fn(),
        collected: new Collection(),
        users: new Collection()
    });
    const message: any = {
        editable: true,
        deletable: true,
        components: [],
        mentions: { repliedUser: { id: "u1" } },
        edit: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: () => collector
    };
    return { message, collector };
}

afterEach(() => {
    applyUxConfig({ prompt: { highlightSelectedButton: false } });
});

describe("promptMessage", () => {
    it("forces withResponse so a fresh interaction reply's collector actually starts", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, { timeout: 1000 });
        await new Promise(resolve => setImmediate(resolve));

        expect(dynaSend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withResponse: true }));

        collector.emit("end", [], "time");
        const result = await resultPromise;
        expect(result.status).toBe("timeout");
    });

    it("resolves confirmed and rejected status from the matching button click", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, { timeout: 1000 });
        await new Promise(resolve => setImmediate(resolve));

        collector.emit("collect", {
            user: { id: "u1" },
            customId: "prompt:confirm",
            reply: vi.fn(),
            deferUpdate: vi.fn().mockResolvedValue(undefined)
        });
        await new Promise(resolve => setImmediate(resolve));
        collector.emit("end", [], "confirmed");

        const result = await resultPromise;
        expect(result.status).toBe("confirmed");
    });
});

describe("prompt resolution payload", () => {
    it.each([
        ["prompt:confirm", "confirmed"],
        ["prompt:reject", "rejected"],
        ["voucher", "custom"],
        [null, "timeout"]
    ] as const)("combines %s with highlighted cleanup in one awaited edit", async (customId, status) => {
        applyUxConfig({ prompt: { highlightSelectedButton: true } });
        const { message, collector } = createFakeMessage();
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("prompt:confirm").setLabel("Yes").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("prompt:reject").setLabel("No").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("voucher").setLabel("Voucher").setStyle(ButtonStyle.Secondary)
        );
        message.components = [row];
        const updated = { ...message, id: "updated" };
        let finishEdit!: () => void;
        message.edit.mockImplementation(
            () =>
                new Promise(resolve => {
                    finishEdit = () => resolve(updated);
                })
        );
        collector.stop.mockImplementation(reason => collector.emit("end", [], reason));
        vi.mocked(dynaSend).mockResolvedValue(message);
        const deferUpdate = vi.fn().mockResolvedValue(undefined);
        const onResolve = vi.fn(async context => {
            if (customId) expect(deferUpdate).toHaveBeenCalled();
            expect(context).toMatchObject({ message, status });
            if (status === "custom") expect(context.customId).toBe("voucher");
            return { action: "disable" as const, embeds: [{ description: "Result" }] };
        });
        let settled = false;
        const pending = promptMessage(
            {} as never,
            {
                timeout: 1000,
                extraButtons: [row.components[2]!],
                onResolve
            },
            { allowedMentions: { repliedUser: false } }
        ).then(result => {
            settled = true;
            return result;
        });
        await new Promise(resolve => setImmediate(resolve));
        if (customId) {
            collector.emit("collect", { user: { id: "u1" }, customId, deferUpdate });
            // A second click already admitted before the stop must not overwrite the first decision.
            collector.emit("collect", { user: { id: "u1" }, customId: "prompt:reject", deferUpdate });
        } else collector.emit("end", [], "time");
        await new Promise(resolve => setImmediate(resolve));
        expect(onResolve).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        const payload = message.edit.mock.calls[0]![0];
        expect(payload).toMatchObject({ embeds: [{ description: "Result" }], allowedMentions: { repliedUser: false } });
        expect(payload.components[0].components.every((c: { disabled: boolean }) => c.disabled)).toBe(true);
        if (customId) {
            const selected = payload.components[0].components.find((c: { custom_id: string }) => c.custom_id === customId);
            expect(selected.style).toBe(
                status === "custom" ? ButtonStyle.Primary : status === "confirmed" ? ButtonStyle.Success : ButtonStyle.Danger
            );
        }
        finishEdit();
        expect((await pending).message).toBe(updated);
    });

    it("propagates a failed final edit without rerunning the callback", async () => {
        const { message, collector } = createFakeMessage();
        const failure = new Error("Discord edit failed");
        message.edit.mockRejectedValue(failure);
        vi.mocked(dynaSend).mockResolvedValue(message);
        const onResolve = vi.fn(() => ({ action: "disable" as const, content: "Paid result" }));
        const pending = promptMessage({} as never, { timeout: 1000, onResolve });
        const rejected = expect(pending).rejects.toThrow(failure);
        await new Promise(resolve => setImmediate(resolve));
        collector.emit("end", [], "time");
        await rejected;
        expect(onResolve).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledOnce();
    });
});

it("resolves an ephemeral prompt through its sending interaction", async () => {
    const { message, collector } = createFakeMessage();
    Object.assign(message, { id: "ephemeral", editable: false, deletable: false });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const handler = Object.assign(Object.create(BaseInteraction.prototype), {
        user: { id: "invoker" },
        webhook: { deleteMessage }
    });
    vi.mocked(dynaSend).mockResolvedValue(message);
    const pending = promptMessage(handler, { timeout: 1000, onResolve: "delete" });
    await new Promise(resolve => setImmediate(resolve));
    collector.emit("end", [], "time");
    await pending;
    expect(deleteMessage).toHaveBeenCalledWith("ephemeral");
    expect(message.delete).not.toHaveBeenCalled();
});

it("always resolves on an extra button, with its customId", async () => {
    const { message, collector } = createFakeMessage();
    collector.stop.mockImplementation(reason => collector.emit("end", [], reason));
    vi.mocked(dynaSend).mockResolvedValue(message);
    const voucher = new ButtonBuilder().setCustomId("voucher").setLabel("Voucher").setStyle(ButtonStyle.Secondary);
    const pending = promptMessage({} as never, { timeout: 1000, extraButtons: [voucher] });
    await new Promise(resolve => setImmediate(resolve));
    collector.emit("collect", {
        user: { id: "u1" },
        customId: "voucher",
        deferUpdate: vi.fn().mockResolvedValue(undefined)
    });
    await expect(pending).resolves.toMatchObject({ status: "custom", customId: "voucher" });
});

describe("prompt defaults", () => {
    const row = {
        toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "a" }] })
    };

    async function run(reason: string, options = {}) {
        const { message, collector } = createFakeMessage();
        message.components = [row];
        vi.mocked(dynaSend).mockResolvedValue(message);
        const pending = promptMessage({} as never, options);
        await new Promise(resolve => setImmediate(resolve));
        collector.emit("end", [], reason);
        await pending;
        return message;
    }

    it("disables on resolve rather than deleting, with no timing given", async () => {
        const message = await run("idle");
        expect(message.delete).not.toHaveBeenCalled();
        expect(message.edit.mock.calls[0]![0].components[0].components[0].disabled).toBe(true);
    });

    it("doesn't edit a prompt whose message was deleted", async () => {
        const message = await run("messageDelete");
        expect(message.edit).not.toHaveBeenCalled();
    });

    it.each([
        ["only the invoker", undefined, true, false],
        ["anyone with anyone", "anyone" as const, true, true],
        ["nobody with an empty list", [], false, false]
    ])("lets in %s", async (_name, participants, invoker, others) => {
        const { message } = createFakeMessage();
        let filter!: (i: unknown) => Promise<boolean>;
        message.createMessageComponentCollector = (options: { filter: typeof filter }) => {
            filter = options.filter;
            return Object.assign(new EventEmitter(), {
                stop: vi.fn(),
                collected: new Collection(),
                users: new Collection()
            });
        };
        vi.mocked(dynaSend).mockResolvedValue(message);
        void promptMessage({} as never, { participants });
        await new Promise(resolve => setImmediate(resolve));
        const click = (id: string) => ({
            user: { id },
            customId: "prompt:confirm",
            reply: vi.fn().mockResolvedValue(undefined)
        });
        expect(await filter(click("u1"))).toBe(invoker);
        expect(await filter(click("someone-else"))).toBe(others);
    });

    describe("sending to a bot's message", () => {
        function botMessage(channelType = ChannelType.GuildText) {
            const target = Object.assign(Object.create(Message.prototype), { author: { bot: true } });
            return Object.defineProperty(target, "channel", { value: { type: channelType } }) as Message;
        }

        beforeEach(() => {
            vi.mocked(dynaSend).mockReset();
        });

        it("throws before sending anything", async () => {
            await expect(promptMessage(botMessage())).rejects.toThrow(/bot's message.*`participants`/);
            await expect(promptMessage(botMessage(), { idle: 1000 }, { content: "x" })).rejects.toThrow(/`participants`/);
            expect(dynaSend).not.toHaveBeenCalled();
        });

        it.each([
            ["participants", botMessage(), { participants: ["a"] }, undefined],
            ["an edit", botMessage(), {}, { method: "edit" }],
            ["a DM", botMessage(ChannelType.DM), {}, undefined]
        ] as const)("still sends with %s", async (_name, target, options, sendOptions) => {
            const { message, collector } = createFakeMessage();
            vi.mocked(dynaSend).mockResolvedValue(message);
            const result = promptMessage(target, options as never, sendOptions);
            await new Promise(resolve => setImmediate(resolve));
            expect(dynaSend).toHaveBeenCalledOnce();
            collector.emit("end", [], "time");
            await result;
        });
    });

    it("rejects when the sent message has no trigger to read", async () => {
        const { message } = createFakeMessage();
        message.mentions.repliedUser = null;
        vi.mocked(dynaSend).mockResolvedValue(message);
        await expect(promptMessage({} as never)).rejects.toThrow(/participants/);
    });
});
