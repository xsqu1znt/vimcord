import { ComponentType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { handleResolveAction, ResolveAction } from "./shared.js";

function createMessage(componentsJSON: unknown[]) {
    const edit = vi.fn(async (opts: { components: unknown[] }) => {
        message.components = opts.components.map(json => ({ toJSON: () => json }));
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
