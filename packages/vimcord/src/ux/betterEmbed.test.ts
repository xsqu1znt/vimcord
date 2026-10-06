import { Client, User } from "discord.js";
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

describe("BetterEmbed token formatting", () => {
    it("preserves escaping, word boundaries, unknown tokens and absent context", () => {
        const embed = new BetterEmbed({
            description: String.raw`\$INVIS $INVIS $INVISIBLE $UNKNOWN $USER $YEAR $year $MONTH $month $DAY $day @name #channel`
        });
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        expect(embed.toJSON().description).toBe(
            `\\$INVIS \u200B $INVISIBLE $UNKNOWN $USER ${now.getFullYear()} ${String(now.getFullYear()).slice(-2)} ${month} ${month} ${day} ${day} @name #channel`
        );
    });

    it("resolves avatars once per build only when used, and reads new context on later builds", async () => {
        const client = new Client({ intents: [] });
        const TestUser = User as unknown as new (client: Client, data: object) => User;
        const user = new TestUser(client, { id: "123", username: "Alice", discriminator: "0", avatar: null });
        const avatar = vi.spyOn(user, "displayAvatarURL").mockReturnValue("https://example.com/a.png");
        const embed = new BetterEmbed({ context: { user }, title: "$USER_NAME", description: "@name #channel" });
        expect(embed.toJSON().title).toBe("Alice");
        expect(avatar).not.toHaveBeenCalled();
        embed.setAuthor({ text: "Name", icon: true }).setDescription("$USER_AVATAR $USER_AVATAR");
        expect(embed.toJSON().description).toBe("https://example.com/a.png https://example.com/a.png");
        expect(avatar).toHaveBeenCalledOnce();
        user.username = "Bob";
        expect(embed.toJSON().title).toBe("Bob");
        expect(avatar).toHaveBeenCalledTimes(2);
        await client.destroy();
    });

    it("keeps ordered substitutions and String.replace syntax in Discord usernames", async () => {
        const client = new Client({ intents: [] });
        const TestUser = User as unknown as new (client: Client, data: object) => User;
        const user = new TestUser(client, { id: "123", username: "$DAY $$ $&", discriminator: "0", avatar: null });
        const embed = new BetterEmbed({ context: { user }, description: "$USER_NAME" });
        expect(embed.toJSON().description).toBe(`${String(new Date().getDate()).padStart(2, "0")} $ $USER_NAME`);
        await client.destroy();
    });
});
