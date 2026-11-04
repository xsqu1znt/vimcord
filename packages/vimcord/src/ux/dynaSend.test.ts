import type { SendHandler } from "./dynaSend.js";

import {
    BaseChannel,
    BaseInteraction,
    GuildMember,
    InteractionCallbackResponse,
    Message,
    MessageFlags,
    User
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { dynaSend, SendMethod } from "./dynaSend.js";

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
        [BaseInteraction.prototype, SendMethod.EditReply, MessageFlags.SuppressEmbeds],
        [BaseInteraction.prototype, SendMethod.FollowUp, MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds],
        [Message.prototype, SendMethod.MessageEdit, MessageFlags.SuppressEmbeds]
    ] as const)("sends once with method-appropriate flags (%#)", async (prototype, sendMethod, flags) => {
        const { handler, send } = target(prototype);
        const options = { content: "Response", sendMethod, flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds };
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

    it("rejects an explicit incompatible method before sending", async () => {
        const { handler, send } = target(User.prototype);
        await expect(dynaSend(handler, { content: "Response", sendMethod: SendMethod.Reply })).rejects.toThrow(
            /requires BaseInteraction/
        );
        expect(send).not.toHaveBeenCalled();
    });
});
