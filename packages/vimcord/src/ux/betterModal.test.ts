import type { Attachment, ModalSubmitFields, ReadonlyCollection, User } from "discord.js";

import { Collection, ComponentType, DiscordjsError, DiscordjsErrorCodes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

vi.mock("./interactionRouter.js", () => ({
    awaitRoutedModal: (client: { awaitModalSubmit(options: unknown): unknown }, customId: string, time: number) =>
        client.awaitModalSubmit({ filter: (i: { customId: string }) => i.customId === customId, time })
}));

function createSubmitInteraction() {
    return {
        fields: {},
        deferUpdate: vi.fn().mockResolvedValue(undefined)
    };
}

function createSource(result: unknown) {
    const source = {
        awaitModalSubmit: vi.fn().mockResolvedValue(result)
    };
    return { ...source, client: source };
}

describe("BetterModal component limit", () => {
    it.each(["labels", "labels and text displays"])("accepts five %s and rejects a sixth component", layout => {
        const modal = new BetterModal({ title: "Feedback" });

        for (let i = 0; i < 5; i++) {
            if (layout === "labels and text displays" && i % 2 === 1) {
                modal.addTextDisplay({ content: "Tell us about your experience." });
            } else {
                modal.addTextInput({ customId: `field-${i}`, label: `Field ${i + 1}` });
            }
        }

        const components = modal.toJSON().components;
        expect(components.map(c => c.type)).toEqual(
            layout === "labels"
                ? Array(5).fill(ComponentType.Label)
                : [
                      ComponentType.Label,
                      ComponentType.TextDisplay,
                      ComponentType.Label,
                      ComponentType.TextDisplay,
                      ComponentType.Label
                  ]
        );

        expect(() => modal.addTextInput({ customId: "overflow", label: "Extra field" })).toThrow(
            "[BetterModal] Modal can only have 5 top-level components"
        );
        expect(() => modal.addTextDisplay({ content: "Extra instructions" })).toThrow(
            "[BetterModal] Modal can only have 5 top-level components"
        );
        expect(modal.toJSON().components).toEqual(components);
    });
});

describe("BetterModal submission results", () => {
    it("returns null only when the Discord.js modal collector expires", async () => {
        const TimeoutError = DiscordjsError as unknown as new (code: DiscordjsErrorCodes, reason: string) => DiscordjsError;
        const source = {
            awaitModalSubmit: vi
                .fn()
                .mockRejectedValue(new TimeoutError(DiscordjsErrorCodes.InteractionCollectorError, "time"))
        };

        const result = await new BetterModal().awaitSubmit({ ...source, client: source } as never, { timeout: 1000 });

        expect(result).toBeNull();
    });

    it("keeps collection and deferral errors observable", async () => {
        const collectionError = new Error("collection failed");
        const deferralError = new Error("deferral failed");
        const failedCollection = { awaitModalSubmit: vi.fn().mockRejectedValue(collectionError) };
        const failedDeferral = createSubmitInteraction();
        failedDeferral.deferUpdate.mockRejectedValue(deferralError);

        await expect(
            new BetterModal().awaitSubmit({ ...failedCollection, client: failedCollection } as never, { timeout: 1000 })
        ).rejects.toBe(collectionError);
        await expect(
            new BetterModal().awaitSubmit(createSource(failedDeferral) as never, {
                timeout: 1000,
                deferUpdate: true
            })
        ).rejects.toBe(deferralError);
    });

    it("forces the follow-up send method after the modal has been acknowledged", async () => {
        const submit = createSubmitInteraction();
        const result = await new BetterModal().awaitSubmit(createSource(submit) as never, { timeout: 1000 });

        await result?.followUp({ content: "Done" });

        expect(dynaSend).toHaveBeenCalledWith(submit, {
            content: "Done",
            sendMethod: "followUp"
        });
    });

    it("falls back to the UX config's timeout", async () => {
        const source = createSource(createSubmitInteraction());
        await new BetterModal().awaitSubmit(source as never);
        expect(source.awaitModalSubmit).toHaveBeenCalledWith(expect.objectContaining({ time: 60_000 }));
    });

    it("reads each input into typed fields, with empty collections for empty selects", async () => {
        const submit = {
            ...createSubmitInteraction(),
            fields: {
                getTextInputValue: () => "Printer on fire",
                getSelectedUsers: () => null,
                getStringSelectValues: () => ["low"],
                getCheckbox: () => true,
                getRadioGroup: () => null,
                getSelectedMentionables: () => null,
                getUploadedFiles: () => null
            } as unknown as ModalSubmitFields
        };
        const result = await new BetterModal({ title: "Create Ticket" })
            .addTextInput({ customId: "subject", label: "Subject" })
            .addUserSelect({ customId: "assignees", label: "Assignees", maxValues: 3 })
            .addStringSelect({ customId: "priority", label: "Priority" })
            .addCheckbox({ customId: "urgent", label: "Urgent" })
            .addFileUpload({ customId: "logs", label: "Logs" })
            .awaitSubmit(createSource(submit) as never);
        if (!result) throw new Error("Expected a submission");

        const subject: string = result.fields.subject;
        const assignees: ReadonlyCollection<string, User> = result.fields.assignees;
        const priority: readonly string[] = result.fields.priority;
        const urgent: boolean = result.fields.urgent;
        const logs: ReadonlyCollection<string, Attachment> = result.fields.logs;
        // @ts-expect-error Only inputs added to the chain are fields.
        expect(result.fields.missing).toBeUndefined();

        expect(subject).toBe("Printer on fire");
        expect(assignees).toEqual(new Collection());
        expect(priority).toEqual(["low"]);
        expect(urgent).toBe(true);
        expect(logs).toEqual(new Collection());
    });

    it("keeps inputs and readers on a clone", async () => {
        const submit = {
            ...createSubmitInteraction(),
            fields: { getTextInputValue: () => "value" } as unknown as ModalSubmitFields
        };
        const modal = new BetterModal({ title: "Title" })
            .addTextInput({ customId: "a", label: "A" })
            .addTextDisplay({ content: "Note" });
        const clone = modal.clone();
        expect(clone.toJSON()).toEqual(modal.toJSON());
        const result = await clone.awaitSubmit(createSource(submit) as never);
        expect(result?.fields.a).toBe("value");
    });

    it("rejects a repeated customId instead of dropping one", () => {
        const modal = new BetterModal().addTextInput({ customId: "a", label: "A" });
        expect(() => modal.addTextInput({ customId: "a", label: "Again" })).toThrow(/Duplicate input customId 'a'/);
    });
});
