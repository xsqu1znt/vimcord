import { describe, expect, it } from "vitest";
import { BetterEmbed } from "./betterEmbed.js";

describe("BetterEmbed zero values", () => {
    it("retains numeric black (0) as an explicit color instead of dropping it", () => {
        const embed = new BetterEmbed({ color: 0 });
        expect(embed.toJSON().color).toBe(0);
    });

    it("treats an explicit false timestamp as no timestamp", () => {
        const embed = new BetterEmbed({ timestamp: false });
        expect(embed.toJSON().timestamp).toBeUndefined();
    });
});

describe("BetterEmbed field limit", () => {
    it("throws instead of silently truncating past 25 fields", () => {
        const fields = Array.from({ length: 26 }, (_, i) => ({ name: `f${i}`, value: "v" }));
        const embed = new BetterEmbed().setFields(fields);
        expect(() => embed.toJSON()).toThrow(/25 fields/);
    });

    it("accepts exactly 25 fields", () => {
        const fields = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, value: "v" }));
        const embed = new BetterEmbed().setFields(fields);
        expect(embed.toJSON().fields).toHaveLength(25);
    });
});

describe("BetterEmbed deferred build", () => {
    it("reflects the final state of chained setters, not an intermediate one", () => {
        const embed = new BetterEmbed().setTitle("first").setTitle("second").setDescription("body");
        expect(embed.toJSON()).toMatchObject({ title: "second", description: "body" });
    });
});
