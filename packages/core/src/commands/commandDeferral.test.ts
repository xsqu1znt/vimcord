import { describe, expect, it } from "vitest";
import { resolveDeferReply } from "./commandDeferral.js";

describe("resolveDeferReply", () => {
    it("uses the route's setting when the route defines one", () => {
        expect(resolveDeferReply(true, false)).toBe(true);
        expect(resolveDeferReply({ flags: "Ephemeral" }, true)).toEqual({ flags: "Ephemeral" });
    });

    it("disables deferral when the route explicitly sets false, even if the command defers", () => {
        expect(resolveDeferReply(false, true)).toBe(false);
    });

    it("falls back to the command's setting when the route leaves it undefined", () => {
        expect(resolveDeferReply(undefined, true)).toBe(true);
        expect(resolveDeferReply(undefined, undefined)).toBeUndefined();
    });
});
