import { describe, expect, it } from "vitest";
import { getCLIFlagValues, hasCLIFlag, parseCLIInput } from "./parser.js";

describe("parseCLIInput", () => {
    it("ignores ordinary process input and parses slash commands", () => {
        expect(parseCLIInput("status message")).toBeNull();
        expect(parseCLIInput("   ")).toBeNull();

        const parsed = parseCLIInput('/register guild "Example Guild" --names ping stats --confirm');
        expect(parsed).not.toBeNull();
        expect(parsed?.name).toBe("register");
        expect(parsed?.args).toEqual(["guild", "Example Guild"]);
        expect(getCLIFlagValues(parsed!.flags, "names")).toEqual(["ping", "stats"]);
        expect(hasCLIFlag(parsed!.flags, "confirm")).toBe(true);
    });

    it("supports equals flags and escaped quoted values", () => {
        const parsed = parseCLIInput('/userinfo "Some \\"User\\"" --client=beta');

        expect(parsed?.args).toEqual(['Some "User"']);
        expect(getCLIFlagValues(parsed!.flags, "client")).toEqual(["beta"]);
    });

    it("rejects unterminated quotes", () => {
        expect(() => parseCLIInput('/guildinfo "unfinished')).toThrow("Unterminated quoted value");
    });
});
