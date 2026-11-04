import { describe, expect, it, vi } from "vitest";
import { applyDeferReply, resolveDeferReply } from "./commandDeferral.js";

describe("resolveDeferReply", () => {
    it("uses the subcommand's setting when it defines one", () => {
        expect(resolveDeferReply(true, false)).toBe(true);
        expect(resolveDeferReply("ephemeral", true)).toBe("ephemeral");
    });

    it("disables deferral when the subcommand explicitly sets false, even if the command defers", () => {
        expect(resolveDeferReply(false, true)).toBe(false);
    });

    it("falls back to the command's setting when the subcommand leaves it undefined", () => {
        expect(resolveDeferReply(undefined, true)).toBe(true);
        expect(resolveDeferReply(undefined, undefined)).toBeUndefined();
    });
});

describe("applyDeferReply", () => {
    it("maps the ephemeral option to the flag and a plain true to no options", async () => {
        const deferReply = vi.fn();
        const interaction = { replied: false, deferred: false, deferReply } as never;
        await applyDeferReply(interaction, "ephemeral");
        await applyDeferReply(interaction, true);
        await applyDeferReply(interaction, false);
        expect(deferReply.mock.calls).toEqual([[{ flags: "Ephemeral" }], [undefined]]);
    });
});
