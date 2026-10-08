import type { InteractionBasedSendHandler } from "./dynaSend.js";

import { ComponentType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { handleResolveAction, ResolveAction } from "./shared.js";

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

describe("handleResolveAction DisableComponents", () => {
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

        await handleResolveAction(message, ResolveAction.DisableComponents);

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

        await handleResolveAction(message, ResolveAction.DisableComponents);

        const [{ components: sections }] = message.edit.mock.calls[0][0].components;
        expect(sections[0].accessory).toMatchObject({ custom_id: "a", disabled: true });
        expect(sections[1].accessory).toEqual({
            type: ComponentType.Thumbnail,
            media: { url: "https://example.com/x.png" }
        });
    });

    it("skips the edit entirely when the message has no components", async () => {
        const message = createMessage([]);
        await handleResolveAction(message, ResolveAction.DisableComponents);
        expect(message.edit).not.toHaveBeenCalled();
    });

    it("skips the edit when a container has no interactive components", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [{ type: ComponentType.TextDisplay, content: "unchanged" }]
            }
        ]);
        await handleResolveAction(message, ResolveAction.DisableComponents);
        expect(message.edit).not.toHaveBeenCalled();
    });
});

describe("handleResolveAction ClearComponents", () => {
    it("skips the edit when a container has no interactive components", async () => {
        const message = createMessage([
            {
                type: ComponentType.Container,
                components: [{ type: ComponentType.TextDisplay, content: "unchanged" }]
            }
        ]);
        await handleResolveAction(message, ResolveAction.ClearComponents);
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

        await handleResolveAction(message, ResolveAction.ClearComponents);

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

        await handleResolveAction(message, ResolveAction.ClearComponents);

        const [{ components: sections }] = message.edit.mock.calls[0][0].components;
        expect(sections[0]).toMatchObject({ type: ComponentType.Section });
        expect(sections[0].accessory).toMatchObject({ type: ComponentType.Button, disabled: true });
    });
});

describe("resolution payload preservation", () => {
    it.each([ResolveAction.DisableComponents, ResolveAction.ClearComponents, ResolveAction.DoNothing])(
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
            action: ResolveAction.DisableComponents,
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
    it.each([ResolveAction.DisableComponents, ResolveAction.ClearComponents, ResolveAction.DoNothing])(
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
            if (action === ResolveAction.ClearComponents) expect(components).toEqual([]);
            if (action === ResolveAction.DisableComponents) expect(components[0].components[0].disabled).toBe(true);
            expect(message.edit).not.toHaveBeenCalled();
        }
    );

    it("deletes ephemeral messages even when Discord marks them undeletable", async () => {
        const message = createMessage([]);
        message.id = "reply";
        message.deletable = false;
        const deleteMessage = vi.fn().mockResolvedValue(undefined);
        await handleResolveAction(message, ResolveAction.DeleteMessage, undefined, {
            webhook: { deleteMessage }
        } as unknown as InteractionBasedSendHandler);
        expect(deleteMessage).toHaveBeenCalledWith("reply");
    });

    it("propagates webhook edit failures", async () => {
        const interaction = {
            webhook: { editMessage: vi.fn().mockRejectedValue(new Error("expired")) }
        } as unknown as InteractionBasedSendHandler;
        await expect(
            handleResolveAction(
                createMessage([]),
                { action: ResolveAction.DoNothing, content: "Done" },
                undefined,
                interaction
            )
        ).rejects.toThrow("expired");
    });
});
