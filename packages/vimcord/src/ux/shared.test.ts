import type { InteractionBasedSendHandler } from "./dynaSend.js";

import { ChannelType, ComponentType, Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { assertTargetHasTrigger, handleResolveAction, resolveParticipantIds, resolveTiming } from "./shared.js";
import { uxConfig } from "./uxConfig.js";

function createMessage(componentsJSON: unknown[]) {
    const edit = vi.fn(async (opts: { components: unknown[] }) => {
        if (opts.components) message.components = opts.components.map(json => ({ toJSON: () => json }));
    });
    const message: any = {
        editable: true,
        deletable: true,
        components: componentsJSON.map(json => ({ toJSON: () => json })),
        edit
    };
    return message;
}

describe("handleResolveAction disable", () => {
    it("disables an action row nested inside a container while preserving text and layout", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                accent_color: 5,
                components: [
                    { type: ComponentType.TextDisplay, content: "hello" },
                    {
                        type: ComponentType.ActionRow,
                        components: [{ type: ComponentType.Button, custom_id: "next", disabled: false }]
                    }
                ]
            }
        ]);

        await handleResolveAction(message, "disable");

        const [{ components }] = message.edit.mock.calls[0][0].components;
        expect(components[0]).toEqual({ type: ComponentType.TextDisplay, content: "hello" });
        expect(components[1].components[0]).toMatchObject({ custom_id: "next", disabled: true });
    });

    it("disables a section's button accessory without touching a thumbnail accessory", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [
                    {
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: "row A" }],
                        accessory: { type: ComponentType.Button, custom_id: "a", disabled: false }
                    },
                    {
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: "row B" }],
                        accessory: { type: ComponentType.Thumbnail, media: { url: "https://example.com/x.png" } }
                    }
                ]
            }
        ]);

        await handleResolveAction(message, "disable");

        const [{ components: sections }] = message.edit.mock.calls[0][0].components;
        expect(sections[0].accessory).toMatchObject({ custom_id: "a", disabled: true });
        expect(sections[1].accessory).toEqual({
            type: ComponentType.Thumbnail,
            media: { url: "https://example.com/x.png" }
        });
    });

    it("skips the edit entirely when the message has no components", async () => {
        const message = createMessage([]);
        await handleResolveAction(message, "disable");
        expect(message.edit).not.toHaveBeenCalled();
    });

    it("skips the edit when a container has no interactive components", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [{ type: ComponentType.TextDisplay, content: "unchanged" }]
            }
        ]);
        await handleResolveAction(message, "disable");
        expect(message.edit).not.toHaveBeenCalled();
    });
});

describe("handleResolveAction clear", () => {
    it("skips the edit when a container has no interactive components", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [{ type: ComponentType.TextDisplay, content: "unchanged" }]
            }
        ]);
        await handleResolveAction(message, "clear");
        expect(message.edit).not.toHaveBeenCalled();
    });

    it("removes a top-level action row but keeps a container and its noninteractive content", async () => {
        const message = createMessage([
            { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "x" }] },
            {
                type: ComponentType.Container,
                components: [
                    { type: ComponentType.TextDisplay, content: "keep me" },
                    { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "y" }] }
                ]
            }
        ]);

        await handleResolveAction(message, "clear");

        const updated = message.edit.mock.calls[0][0].components;
        expect(updated).toHaveLength(1);
        expect(updated[0].type).toBe(ComponentType.Container);
        expect(updated[0].components).toEqual([{ type: ComponentType.TextDisplay, content: "keep me" }]);
    });

    it("disables a section's button accessory instead of deleting it, since Discord requires an accessory", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [
                    {
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: "row" }],
                        accessory: { type: ComponentType.Button, custom_id: "a", disabled: false }
                    }
                ]
            }
        ]);

        await handleResolveAction(message, "clear");

        const [{ components: sections }] = message.edit.mock.calls[0][0].components;
        expect(sections[0]).toMatchObject({ type: ComponentType.Section });
        expect(sections[0].accessory).toMatchObject({ type: ComponentType.Button, disabled: true });
    });
});

describe("resolution payload preservation", () => {
    it.each(["disable", "clear", "keep"] as const)(
        "delivers content and files with %s even when components are absent or unchanged",
        async action => {
            const files = [{ attachment: Buffer.from("card"), name: "card.png" }];
            for (const components of [
                [],
                [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, disabled: true }] }]
            ]) {
                const message = createMessage(components);
                await handleResolveAction(message, { action, content: "Result", files });
                expect(message.edit).toHaveBeenCalledOnce();
                expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "Result", files }));
            }
        }
    );

    it("applies cleanup to replacement components while delivering the payload", async () => {
        const message = createMessage([]);
        await handleResolveAction(message, {
            action: "disable",
            content: "Result",
            components: [
                {
                    type: ComponentType.ActionRow,
                    components: [{ type: ComponentType.Button, custom_id: "new", style: 1, label: "New" }]
                }
            ]
        });
        expect(message.edit.mock.calls[0][0].components[0].components[0]).toMatchObject({
            custom_id: "new",
            disabled: true
        });
    });
});

describe("interaction resolution", () => {
    it.each(["disable", "clear", "keep"] as const)(
        "edits an ephemeral follow-up by message ID with %s and preserves payloads",
        async action => {
            const message = createMessage([
                { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "next" }] }
            ]);
            message.id = "follow-up";
            message.editable = false;
            const updated = createMessage([]);
            const editMessage = vi.fn().mockResolvedValue(updated);
            const interaction = { webhook: { editMessage } } as unknown as InteractionBasedSendHandler;
            const result = await handleResolveAction(message, { action, content: "Done" }, { parse: [] }, interaction);
            expect(result).toBe(updated);
            expect(editMessage).toHaveBeenCalledWith(
                "follow-up",
                expect.objectContaining({ content: "Done", allowedMentions: { parse: [] } })
            );
            const components = editMessage.mock.calls[0]![1].components;
            if (action === "clear") expect(components).toEqual([]);
            if (action === "disable") expect(components[0].components[0].disabled).toBe(true);
            expect(message.edit).not.toHaveBeenCalled();
        }
    );

    it("deletes ephemeral messages even when Discord marks them undeletable", async () => {
        const message = createMessage([]);
        message.id = "reply";
        message.deletable = false;
        const deleteMessage = vi.fn().mockResolvedValue(undefined);
        await handleResolveAction(message, "delete", undefined, {
            webhook: { deleteMessage }
        } as unknown as InteractionBasedSendHandler);
        expect(deleteMessage).toHaveBeenCalledWith("reply");
    });

    it("propagates webhook edit failures", async () => {
        const interaction = {
            webhook: { editMessage: vi.fn().mockRejectedValue(new Error("expired")) }
        } as unknown as InteractionBasedSendHandler;
        await expect(
            handleResolveAction(createMessage([]), { action: "keep", content: "Done" }, undefined, interaction)
        ).rejects.toThrow("expired");
    });
});

describe("resolveTiming", () => {
    it("defaults to the configured idle, and keeps whichever one is given", () => {
        expect(resolveTiming({})).toEqual({ idle: uxConfig.defaultIdle, timeout: null });
        expect(resolveTiming({ idle: 5 })).toEqual({ idle: 5, timeout: null });
        expect(resolveTiming({ timeout: 5 })).toEqual({ idle: null, timeout: 5 });
    });

    it("throws rather than dropping one when both are forced through", () => {
        expect(() => resolveTiming({ idle: 1, timeout: 1 } as never)).toThrow(/Only one of/);
    });
});

describe("resolveParticipantIds", () => {
    const invoker = { id: "invoker" };
    const metadataUser = { id: "metadata" };
    const repliedUser = { id: "replied" };

    function message(data: { metadata?: object; replied?: object | null; channelType?: ChannelType } = {}) {
        return {
            interactionMetadata: data.metadata ? { user: data.metadata } : null,
            mentions: { repliedUser: data.replied ?? null },
            channel: data.channelType === undefined ? null : { type: data.channelType }
        } as never;
    }

    it("infers in order: the interaction option, the message's interaction metadata, then the replied user", () => {
        const all = message({ metadata: metadataUser, replied: repliedUser });
        expect(resolveParticipantIds(undefined, all, { user: invoker } as never)).toEqual(new Set(["invoker"]));
        expect(resolveParticipantIds(undefined, all)).toEqual(new Set(["metadata"]));
        expect(resolveParticipantIds(undefined, message({ replied: repliedUser }))).toEqual(new Set(["replied"]));
    });

    it("prefers a trigger to the open DM rule", () => {
        const dm = message({ replied: repliedUser, channelType: ChannelType.DM });
        expect(resolveParticipantIds(undefined, dm)).toEqual(new Set(["replied"]));
    });

    it("stays open in a DM with no trigger", () => {
        expect(resolveParticipantIds(undefined, message({ channelType: ChannelType.DM }))).toBeNull();
    });

    it.each([
        ["a guild channel", { channelType: ChannelType.GuildText }],
        ["a group DM", { channelType: ChannelType.GroupDM }],
        ["an uncached channel", {}]
    ])("throws in %s with no trigger, naming both ways out", (_name, data) => {
        expect(() => resolveParticipantIds(undefined, message(data))).toThrow(/`participants`.*"anyone"/);
    });

    it.each([
        ["this bot", "bot"],
        ["another bot", "other-bot"]
    ])("doesn't lock a reply to %s's message to that bot", (_name, id) => {
        const reply = (channelType: ChannelType) => message({ replied: { id, bot: true }, channelType });
        expect(() => resolveParticipantIds(undefined, reply(ChannelType.GuildText))).toThrow(/participants/);
        expect(resolveParticipantIds(undefined, reply(ChannelType.DM))).toBeNull();
    });

    it("uses an explicit option without reading the message at all", () => {
        const unread = {} as never;
        expect(resolveParticipantIds("anyone", unread)).toBeNull();
        expect(resolveParticipantIds([], unread)).toEqual(new Set());
        expect(resolveParticipantIds(["a", { id: "b" } as never], unread)).toEqual(new Set(["a", "b"]));
    });
});

describe("assertTargetHasTrigger", () => {
    function target(bot: boolean, channelType: ChannelType | null = ChannelType.GuildText) {
        const message = Object.assign(Object.create(Message.prototype), { author: { bot } });
        const channel = channelType === null ? null : { type: channelType };
        return Object.defineProperty(message, "channel", { value: channel }) as Message;
    }

    it("throws for a bot's message with nothing else to go on, naming the way out", () => {
        expect(() => assertTargetHasTrigger(target(true), undefined, undefined)).toThrow(/bot's message.*`participants`/);
        expect(() => assertTargetHasTrigger(target(true), undefined, "followUp")).toThrow(/`participants`/);
        expect(() => assertTargetHasTrigger(target(true, ChannelType.GroupDM), undefined, undefined)).toThrow(
            /participants/
        );
        expect(() => assertTargetHasTrigger(target(true, null), undefined, undefined)).toThrow(/participants/);
    });

    it.each([
        ["a DM", target(true, ChannelType.DM), undefined, undefined],
        ["an edit", target(true), undefined, "edit"],
        ["a participants list", target(true), ["a"], undefined],
        ["an empty participants list", target(true), [], undefined],
        ['"anyone"', target(true), "anyone", undefined],
        ["a user's message", target(false), undefined, undefined],
        ["a target that isn't a message", { author: { bot: true } }, undefined, undefined]
    ] as const)("lets through %s", (_name, handler, participants, method) => {
        expect(() => assertTargetHasTrigger(handler as never, participants as never, method)).not.toThrow();
    });
});
