import type { ChatInputCommandInteraction } from "discord.js";
import type { SendHandler } from "./dynaSend.js";

import {
    ActionRowBuilder,
    BaseChannel,
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    GuildMember,
    InteractionCallbackResponse,
    Message,
    MessageFlags,
    User
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterCollector } from "./betterCollector.js";
import { BetterContainer } from "./BetterContainer.js";
import { BetterEmbed } from "./betterEmbed.js";
import { dynaSend } from "./dynaSend.js";

function target(prototype: object) {
    const send = vi.fn().mockResolvedValue(null);
    const handler = Object.create(prototype) as SendHandler;
    Object.defineProperties(
        handler,
        Object.fromEntries(
            Object.entries({
                replied: false,
                deferred: false,
                editable: true,
                reply: send,
                editReply: send,
                followUp: send,
                send,
                edit: send
            }).map(([key, value]) => [key, { value, writable: true }])
        )
    );
    return { handler, send };
}

describe("dynaSend transport", () => {
    it.each([
        [BaseInteraction.prototype, undefined, MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds],
        [BaseChannel.prototype, undefined, MessageFlags.SuppressEmbeds],
        [Message.prototype, undefined, MessageFlags.SuppressEmbeds],
        [GuildMember.prototype, undefined, MessageFlags.SuppressEmbeds],
        [User.prototype, undefined, MessageFlags.SuppressEmbeds],
        [BaseInteraction.prototype, "edit", MessageFlags.SuppressEmbeds],
        [BaseInteraction.prototype, "followUp", MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds],
        [Message.prototype, "edit", MessageFlags.SuppressEmbeds]
    ] as const)("sends once with method-appropriate flags (%#)", async (prototype, method, flags) => {
        const { handler, send } = target(prototype);
        const options = { content: "Response", method, flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds };
        await dynaSend(handler, options);
        expect(send).toHaveBeenCalledExactlyOnceWith({ content: "Response", flags });
        expect(options.flags).toBe(MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds);
    });

    it.each(["replied", "deferred"] as const)("edits an interaction that is already %s", async state => {
        const { handler } = target(BaseInteraction.prototype);
        Object.defineProperty(handler, state, { value: true });
        const editReply = vi.fn().mockResolvedValue(null);
        Object.defineProperty(handler, "editReply", { value: editReply });
        await dynaSend(handler, { content: "Updated" });
        expect(editReply).toHaveBeenCalledExactlyOnceWith({ content: "Updated", flags: undefined });
    });

    it("uses a callback's message without fetching a reply", async () => {
        const { handler, send } = target(BaseInteraction.prototype);
        const message = {} as Message;
        const response: InteractionCallbackResponse = Object.create(InteractionCallbackResponse.prototype);
        Object.defineProperty(response, "resource", { value: { message } });
        send.mockResolvedValue(response);
        expect(await dynaSend(handler, { content: "Response", withResponse: true })).toBe(message);
        expect(send).toHaveBeenCalledOnce();
    });

    it("rejects a method that doesn't fit the target before sending", async () => {
        const { handler, send } = target(User.prototype);
        await expect(dynaSend(handler, { content: "Response", method: "followUp" })).rejects.toThrow(
            /requires an interaction/
        );
        await expect(dynaSend(handler, { content: "Response", method: "edit" })).rejects.toThrow(/interaction or a message/);
        expect(send).not.toHaveBeenCalled();
    });

    it("splits a flat button list into rows of 5 and passes built rows through untouched", async () => {
        const { handler, send } = target(BaseChannel.prototype);
        const buttons = Array.from({ length: 7 }, (_, i) =>
            new ButtonBuilder().setCustomId(`b${i}`).setLabel(`${i}`).setStyle(ButtonStyle.Primary)
        );
        await dynaSend(handler, { components: buttons });
        const rows = send.mock.calls[0]![0].components as ActionRowBuilder[];
        expect(rows.map(r => r.components.length)).toEqual([5, 2]);

        const built = [new ActionRowBuilder<ButtonBuilder>().setComponents(buttons[0]!)];
        await dynaSend(handler, { components: built });
        expect(send.mock.calls[1]![0].components).toBe(built);
    });

    it("throws rather than return nothing when the message was asked for", async () => {
        const { handler } = target(BaseInteraction.prototype);
        await expect(dynaSend(handler, { content: "Response", withResponse: true })).rejects.toThrow(/did not return/);
    });
});

describe("message typing", () => {
    it("types a message only when the target or options guarantee one", () => {
        const check = async (interaction: ChatInputCommandInteraction, user: User) => {
            const direct: Message = await dynaSend(user, { content: "a" });
            const requested: Message = await dynaSend(interaction, { content: "a", withResponse: true });
            const followUp: Message = await dynaSend(interaction, { content: "a", method: "followUp" });
            // @ts-expect-error A fresh interaction reply has no message without withResponse.
            const missing: Message = await dynaSend(interaction, { content: "a" });
            const embed = new BetterEmbed();
            const fromEmbed: Message = await embed.send(interaction, { withResponse: true });
            // @ts-expect-error Forgetting withResponse is a compile error for the collector.
            new BetterCollector(await embed.send(interaction), { idle: 1 });
            const container = new BetterContainer();
            const fromContainer: Message = await container.send(user);
            // @ts-expect-error Same for a container.
            const noMessage: Message = await container.send(interaction);
            return [direct, requested, followUp, missing, fromEmbed, fromContainer, noMessage];
        };
        expect(check).toBeTypeOf("function");
    });
});
