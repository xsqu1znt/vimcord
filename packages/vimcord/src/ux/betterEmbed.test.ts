import type { ChatInputCommandInteraction } from "discord.js";

import { BaseInteraction, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
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

describe("BetterEmbed text", () => {
    it("sends $-prefixed text unchanged", () => {
        const embed = new BetterEmbed({ title: "$USER", description: "$YEAR costs $5" });
        expect(embed.toJSON()).toMatchObject({ title: "$USER", description: "$YEAR costs $5" });
    });
});

describe("BetterEmbed API payload", () => {
    it("serializes rich fields with Discord API keys and keeps returned payloads independent", () => {
        const embed = new BetterEmbed({
            author: { text: "Author", icon: "https://example.com/author.png", hyperlink: "https://example.com/author" },
            title: { text: "Title", hyperlink: "https://example.com/title" },
            description: ["First", false, "", "Last"],
            footer: { text: "Footer", icon: "https://example.com/footer.png" },
            thumbnailUrl: "https://example.com/thumb.png",
            imageUrl: "https://example.com/image.png",
            fields: [{ name: "Field", value: "Value", inline: true }],
            color: "Red",
            timestamp: new Date("2026-01-01T00:00:00Z")
        });
        const payload = embed.toJSON();
        expect(payload).toEqual({
            author: { name: "Author", icon_url: "https://example.com/author.png", url: "https://example.com/author" },
            title: "Title",
            url: "https://example.com/title",
            description: "First\n\nLast",
            footer: { text: "Footer", icon_url: "https://example.com/footer.png" },
            thumbnail: { url: "https://example.com/thumb.png" },
            image: { url: "https://example.com/image.png" },
            fields: [{ name: "Field", value: "Value", inline: true }],
            color: 0xed4245,
            timestamp: "2026-01-01T00:00:00.000Z"
        });
        payload.fields![0]!.name = "Changed";
        payload.author!.name = "Changed";
        expect(embed.toJSON().fields![0]!.name).toBe("Field");
        expect(embed.toJSON().author!.name).toBe("Author");
    });

    it("resolves dynamic colors and time per serialization, including epoch zero", () => {
        const random = vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
        const embed = new BetterEmbed({ color: [0, 0xffffff], timestamp: 0 });
        try {
            expect(embed.toJSON()).toMatchObject({ color: 0, timestamp: "1970-01-01T00:00:00.000Z" });
            expect(embed.toJSON().color).toBe(0xffffff);
        } finally {
            random.mockRestore();
        }
    });
});

describe("BetterEmbed sending", () => {
    it("edits a message through message.edit and follows up through the interaction", async () => {
        const embed = new BetterEmbed({ title: "Title" });
        const edit = vi.fn().mockResolvedValue({ id: "edited" });
        const message = Object.create(Message.prototype) as Message;
        Object.defineProperties(message, { edit: { value: edit }, editable: { value: true } });
        await embed.edit(message, { content: "Text" });
        expect(edit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: "Text", embeds: [embed] }));

        const followUp = vi.fn().mockResolvedValue({ id: "followed" });
        const interaction = Object.create(BaseInteraction.prototype) as ChatInputCommandInteraction;
        Object.defineProperty(interaction, "followUp", { value: followUp });
        await embed.followUp(interaction);
        expect(followUp).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ embeds: [embed] }));
    });
});
