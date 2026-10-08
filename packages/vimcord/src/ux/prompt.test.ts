import EventEmitter from "node:events";
import { ActionRowBuilder, BaseInteraction, ButtonBuilder, ButtonStyle } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { dynaSend } from "./dynaSend.js";
import { promptMessage } from "./prompt.js";
import { ResolveAction } from "./shared.js";

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
    const collector = Object.assign(new EventEmitter(), { stop: vi.fn() });
    const message: any = {
        editable: true,
        deletable: true,
        components: [],
        edit: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: () => collector
    };
    return { message, collector };
}

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

    it("settles the prompt even when the collector ends synchronously inside onCollector", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, {
            timeout: 1000,
            onCollector: () => {
                // "end" fires before onCollector itself returns; the completion listener must
                // already be registered or the prompt would hang forever waiting on it.
                collector.emit("end", [], "stopped-during-oncollector");
            }
        });

        const result = await resultPromise;
        expect(result.status).toBe("timeout");
    });
});

describe("prompt resolution payload", () => {
    it.each([
        ["prompt:confirm", "confirmed"],
        ["prompt:reject", "rejected"],
        ["voucher", "custom"],
        [null, "timeout"]
    ] as const)("combines %s with highlighted cleanup in one awaited edit", async (customId, status) => {
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
            return { action: ResolveAction.DisableComponents, embeds: [{ description: "Result" }] };
        });
        let settled = false;
        const pending = promptMessage(
            {} as never,
            {
                timeout: 1000,
                additionalButtons: [row.components[2]!],
                resolveOnAdditionalButton: true,
                highlightSelectedButton: true,
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
        const onResolve = vi.fn(() => ({ action: ResolveAction.DisableComponents, content: "Paid result" }));
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
    const handler = Object.assign(Object.create(BaseInteraction.prototype), { webhook: { deleteMessage } });
    vi.mocked(dynaSend).mockResolvedValue(message);
    const pending = promptMessage(handler, { timeout: 1000 });
    await new Promise(resolve => setImmediate(resolve));
    collector.emit("end", [], "time");
    await pending;
    expect(deleteMessage).toHaveBeenCalledWith("ephemeral");
    expect(message.delete).not.toHaveBeenCalled();
});
