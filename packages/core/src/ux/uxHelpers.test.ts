import type { ModalSubmitFields, ModalSubmitInteraction } from "discord.js";
import type { ModalShowableInteraction } from "./betterModal.js";

import { Collection, ComponentType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterEmbed } from "./betterEmbed.js";
import { BetterModal } from "./betterModal.js";
import { getGlobalUxConfig } from "./uxConfig.js";

describe("BetterEmbed", () => {
    it("keeps intentional blank description lines and removes other falsey entries", () => {
        const embed = new BetterEmbed({
            description: ["First", false, 0, 0n, null, undefined, "", "Third"]
        });

        expect(embed.toJSON().description).toBe("First\n\nThird");
    });
});

describe("BetterModal", () => {
    it("exposes simplified, component-typed, and Discord getter field access", async () => {
        const users = new Collection([["user", { id: "user" }]]);
        const fields = {
            getField: vi.fn((customId: string, type?: ComponentType) => {
                const field =
                    customId === "subject"
                        ? { customId, type: ComponentType.TextInput, value: "Support" }
                        : { customId, type: ComponentType.UserSelect, users };

                if (type !== undefined && type !== field.type) throw new Error("Unexpected component type");
                return field;
            }),
            getTextInputValue: vi.fn(() => "Support"),
            getSelectedUsers: vi.fn(() => users)
        } as unknown as ModalSubmitFields;
        const modalSubmit = { fields } as ModalSubmitInteraction;
        const interaction = {
            awaitModalSubmit: vi.fn(async () => modalSubmit)
        } as unknown as ModalShowableInteraction;
        const modal = new BetterModal({ title: "Create Ticket" }).addTextInput({
            customId: "subject",
            label: "Subject"
        });

        const result = await modal.awaitSubmit(interaction, { timeout: 1_000 });

        expect(result?.values).toEqual(["Support"]);
        expect(result?.getField<string>("subject", true)).toBe("Support");
        expect(result?.getField("users", ComponentType.UserSelect, true)).toBe(users);
        expect(result?.getField("users", "getSelectedUsers", true)).toBe(users);
    });
});

describe("tool config", () => {
    it("uses label-only paginator buttons by default", () => {
        const buttons = Object.values(getGlobalUxConfig().paginator.buttons);

        expect(buttons.every(button => button.label && !button.emoji)).toBe(true);
    });
});
