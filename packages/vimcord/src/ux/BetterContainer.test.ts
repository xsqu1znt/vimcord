import type { ChatInputCommandInteraction } from "discord.js";

import { BaseInteraction, MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterContainer } from "./BetterContainer.js";

describe("BetterContainer.clone", () => {
    it("copies text, sections, and color, and mutating the clone does not mutate the original", () => {
        const original = new BetterContainer({ color: 0x123456 })
            .addText("hello")
            .addSection({ text: "section text", button: { label: "Go", customId: "go" } });

        const clone = original.clone();
        clone.addText("only on the clone");

        const originalJSON = original.toJSON();
        const cloneJSON = clone.toJSON();

        expect(originalJSON.components).toHaveLength(2);
        expect(cloneJSON.components).toHaveLength(3);
        expect(originalJSON.accent_color).toBe(cloneJSON.accent_color);
    });

    it("applies a color override on the clone without touching the original", () => {
        const original = new BetterContainer({ color: 0x111111 }).addText("hi");
        const clone = original.clone({ color: 0x222222 });

        expect(original.toJSON().accent_color).toBe(0x111111);
        expect(clone.toJSON().accent_color).toBe(0x222222);
    });
});

describe("BetterContainer color", () => {
    it("retains numeric black (0) as an explicit color instead of dropping it", () => {
        const container = new BetterContainer({ color: 0 });
        expect(container.toJSON().accent_color).toBe(0);
    });

    it("clears the color when set to null", () => {
        const container = new BetterContainer({ color: 0x123456 }).setColor(null);
        expect(container.toJSON().accent_color).toBeUndefined();
    });
});

describe("BetterContainer sending", () => {
    function interaction() {
        const send = vi.fn().mockResolvedValue({ id: "message" });
        const target = Object.create(BaseInteraction.prototype) as ChatInputCommandInteraction;
        Object.defineProperties(target, {
            replied: { value: false },
            deferred: { value: false },
            reply: { value: send },
            followUp: { value: send },
            editReply: { value: send }
        });
        return { target, send };
    }

    it("doesn't ask for the response on a plain send", async () => {
        const { target, send } = interaction();
        send.mockResolvedValue(undefined);
        expect(await new BetterContainer().addText("hi").send(target)).toBeNull();
        expect(send.mock.calls[0]![0]).not.toHaveProperty("withResponse");
    });

    it.each(["followUp", "edit"] as const)("keeps the Components V2 flag through %s", async method => {
        const { target, send } = interaction();
        await new BetterContainer().addText("hi")[method](target);
        expect(send.mock.calls[0]![0].flags).toBe(MessageFlags.IsComponentsV2);
    });
});
