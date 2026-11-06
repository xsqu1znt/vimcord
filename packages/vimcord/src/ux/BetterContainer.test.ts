import type { ChatInputCommandInteraction, Message } from "discord.js";

import {
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    MessagePayload,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder
} from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { BetterContainer } from "./BetterContainer.js";
import { handleResolveAction } from "./shared.js";

function button(id: string) {
    return new ButtonBuilder().setCustomId(id).setLabel(id).setStyle(ButtonStyle.Primary);
}

const POOL = [0x111111, 0x222222, 0x333333];

describe("BetterContainer color", () => {
    it("retains numeric black (0) as an explicit color instead of dropping it", () => {
        const container = new BetterContainer({ color: 0 });
        expect(container.toJSON().accent_color).toBe(0);
    });

    it("clears the color when set to null", () => {
        const container = new BetterContainer({ color: 0x123456 }).setColor(null);
        expect(container.toJSON().accent_color).toBeUndefined();
    });

    it.each([
        ["the constructor", () => new BetterContainer({ color: POOL })],
        ["setColor", () => new BetterContainer({ color: null }).setColor(POOL)]
    ])("rolls a color pool once in %s, so serializing never re-rolls it", (_name, create) => {
        const random = vi.spyOn(Math, "random").mockReturnValue(0);
        const container = create();
        const first = container.toJSON().accent_color;
        random.mockReturnValue(0.99);
        expect(container.toJSON().accent_color).toBe(first);
        expect(first).toBe(POOL[0]);
        random.mockRestore();
    });
});

describe("BetterContainer.addRow", () => {
    function rows(container: BetterContainer) {
        return container.toJSON().components as unknown as { type: ComponentType; components: { custom_id: string }[] }[];
    }

    it("splits buttons into rows of 5", () => {
        const ids = Array.from({ length: 11 }, (_, i) => `b${i}`);
        const built = rows(new BetterContainer().addRow(...ids.map(button)));
        expect(built.map(r => r.type)).toEqual(Array(3).fill(ComponentType.ActionRow));
        expect(built.map(r => r.components.map(c => c.custom_id))).toEqual([
            ids.slice(0, 5),
            ids.slice(5, 10),
            ids.slice(10)
        ]);
    });

    it("puts a single select in its own row", () => {
        const select = new StringSelectMenuBuilder().setCustomId("s").addOptions({ label: "a", value: "a" });
        expect(rows(new BetterContainer().addRow(select))[0]!.components[0]!.custom_id).toBe("s");
    });

    it("throws on mixed components and on more than one select, before adding anything", () => {
        const select = new UserSelectMenuBuilder().setCustomId("s");
        const container = new BetterContainer();
        expect(() => container.addRow(button("b"), select)).toThrow(/mix/);
        expect(() => container.addRow(select, button("b"))).toThrow(/mix/);
        expect(() => container.addRow(select, new UserSelectMenuBuilder().setCustomId("t"))).toThrow(/one select/);
        expect(container.toJSON().components).toEqual([]);
    });
});

describe("BetterContainer text", () => {
    it("drops every conditional falsey value, keeping a blank line that's a list entry", () => {
        const container = new BetterContainer().addText(["a", false, 0, 0n, null, undefined, "", "b"]);
        expect(container.toJSON().components[0]).toMatchObject({ content: "a\n\nb" });
    });

    it.each([false, null, "", [false, null]] as const)("adds nothing for %j", text => {
        expect(new BetterContainer().addText(text as false).toJSON().components).toEqual([]);
    });
});

describe("BetterContainer sections", () => {
    const text = "Section";
    const accessory = (options: Parameters<BetterContainer["addSection"]>[0]) =>
        (new BetterContainer().addSection({ text, ...options }).toJSON().components[0] as unknown as { accessory: object })
            .accessory;

    it("takes a thumbnail as a URL or as data", () => {
        const url = "https://example.com/a.png";
        const expected = { type: ComponentType.Thumbnail, media: { url } };
        expect(accessory({ thumbnail: url })).toMatchObject(expected);
        expect(accessory({ thumbnail: { media: { url } } })).toMatchObject(expected);
    });

    it("keeps a builder's button style, and defaults data objects to Secondary", () => {
        expect(accessory({ button: button("b") })).toMatchObject({ custom_id: "b", style: ButtonStyle.Primary });
        expect(accessory({ button: { customId: "d", label: "D" } })).toMatchObject({
            custom_id: "d",
            style: ButtonStyle.Secondary
        });
    });
});

describe("BetterContainer as a component", () => {
    it("adds a visible separator with no arguments, and keeps the options", () => {
        const [plain, styled] = new BetterContainer()
            .addSeparator()
            .addSeparator({ divider: false, spacing: 2 })
            .toJSON().components;
        expect(plain).toEqual({ type: ComponentType.Separator });
        expect(styled).toMatchObject({ divider: false, spacing: 2 });
    });

    it("serializes through Discord.js's own message payload", () => {
        const container = new BetterContainer({ color: 1 }).addText("hi");
        const check = (message: Message) => message.edit({ components: [container] });
        expect(check).toBeTypeOf("function");
        const { body } = new MessagePayload({ client: { options: {} } } as never, { components: [container] }).resolveBody();
        expect((body as { components: unknown[] }).components).toEqual([container.toJSON()]);
    });

    it("works in a resolve payload", async () => {
        const container = new BetterContainer({ color: 1 }).addRow(button("b"));
        const edit = vi.fn();
        const message = { editable: true, components: [], edit } as unknown as Message;
        await handleResolveAction(message, { action: "disable", components: [container] });
        const [sent] = edit.mock.calls[0]![0].components;
        expect(sent.components[0].components[0]).toMatchObject({ custom_id: "b", disabled: true });
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
