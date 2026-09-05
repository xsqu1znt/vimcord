import { DiscordjsError, DiscordjsErrorCodes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterModal } from "./betterModal.js";
import { dynaSend, SendMethod } from "./dynaSend.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

function createSubmitInteraction() {
    return {
        fields: {},
        deferUpdate: vi.fn().mockResolvedValue(undefined)
    };
}

function createSource(result: unknown) {
    return {
        awaitModalSubmit: vi.fn().mockResolvedValue(result)
    };
}

describe("BetterModal submission results", () => {
    it("returns null only when the Discord.js modal collector expires", async () => {
        const TimeoutError = DiscordjsError as unknown as new (code: DiscordjsErrorCodes, reason: string) => DiscordjsError;
        const source = {
            awaitModalSubmit: vi
                .fn()
                .mockRejectedValue(new TimeoutError(DiscordjsErrorCodes.InteractionCollectorError, "time"))
        };

        const result = await new BetterModal().awaitSubmit(source as never, { timeout: 1000 });

        expect(result).toBeNull();
    });

    it("keeps collection and deferral errors observable", async () => {
        const collectionError = new Error("collection failed");
        const deferralError = new Error("deferral failed");
        const failedCollection = { awaitModalSubmit: vi.fn().mockRejectedValue(collectionError) };
        const failedDeferral = createSubmitInteraction();
        failedDeferral.deferUpdate.mockRejectedValue(deferralError);

        await expect(new BetterModal().awaitSubmit(failedCollection as never, { timeout: 1000 })).rejects.toBe(
            collectionError
        );
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
            sendMethod: SendMethod.FollowUp
        });
    });
});
