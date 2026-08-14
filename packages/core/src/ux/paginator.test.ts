import type { Message, MessageComponentInteraction } from "discord.js";

import { describe, expect, it, vi } from "vitest";
import { Paginator } from "./paginator.js";

interface CollectorHarness {
    message: Message;
    collect: (interaction: MessageComponentInteraction) => Promise<void>;
}

interface PaginatorInternals {
    collectComponents(): void;
    state: { message: Message | null };
}

function createCollectorHarness(): CollectorHarness {
    let collectHandler: ((interaction: MessageComponentInteraction) => unknown) | undefined;

    const collector = {
        on: (event: "collect" | "end", handler: (interaction: MessageComponentInteraction) => unknown) => {
            if (event === "collect") collectHandler = handler;
        },
        stop: vi.fn()
    };
    const message = {
        createMessageComponentCollector: vi.fn(() => collector)
    } as unknown as Message;

    return {
        message,
        async collect(interaction) {
            if (!collectHandler) throw new Error("Collector was not initialized");
            await collectHandler(interaction);
        }
    };
}

function createInteraction(customId: string): MessageComponentInteraction {
    let acknowledged = false;

    const interaction = {
        customId,
        deferred: false,
        replied: false,
        user: { id: "user" },
        deferUpdate: vi.fn(async () => {
            if (acknowledged) throw new Error("InteractionAlreadyReplied");
            acknowledged = true;
            interaction.deferred = true;
        }),
        showModal: vi.fn(async () => {
            if (acknowledged) throw new Error("InteractionAlreadyReplied");
            acknowledged = true;
            interaction.replied = true;
        })
    } as unknown as MessageComponentInteraction;

    return interaction;
}

async function createPaginator(pages = ["first", "second"]): Promise<{ harness: CollectorHarness; paginator: Paginator }> {
    const harness = createCollectorHarness();
    const paginator = new Paginator({ pages, timeout: 60_000 });
    const internals = paginator as unknown as PaginatorInternals;

    await paginator.setPage();
    internals.state.message = harness.message;
    internals.collectComponents();

    return { harness, paginator };
}

describe("Paginator custom component handlers", () => {
    it("creates a collector for a single page without paginator controls", async () => {
        const { harness, paginator } = await createPaginator(["first"]);
        const handler = vi.fn();
        const interaction = createInteraction("custom:single-page");

        paginator.on("custom:single-page", handler);
        await harness.collect(interaction);

        expect(harness.message.createMessageComponentCollector).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(interaction);
    });

    it("receives an unacknowledged interaction by default", async () => {
        const { harness, paginator } = await createPaginator();
        const handler = vi.fn((interaction: MessageComponentInteraction) => {
            expect(interaction.deferred).toBe(false);
            expect(interaction.replied).toBe(false);
        });
        const interaction = createInteraction("custom:default");

        paginator.on("custom:default", handler);
        await harness.collect(interaction);

        expect(handler).toHaveBeenCalledWith(interaction);
        expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("allows a custom handler to show a modal", async () => {
        const { harness, paginator } = await createPaginator();
        const interaction = createInteraction("custom:modal");
        const handler = vi.fn(async (componentInteraction: MessageComponentInteraction) => {
            await componentInteraction.showModal({} as never);
        });

        paginator.on("custom:modal", handler);
        await harness.collect(interaction);

        expect(handler).toHaveBeenCalledWith(interaction);
        expect(interaction.showModal).toHaveBeenCalledOnce();
        expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("can defer update before a custom handler runs", async () => {
        const { harness, paginator } = await createPaginator();
        const handler = vi.fn((interaction: MessageComponentInteraction) => {
            expect(interaction.deferred).toBe(true);
        });
        const interaction = createInteraction("custom:deferred");

        paginator.on("custom:deferred", handler, { deferUpdate: true });
        await harness.collect(interaction);

        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(interaction);
    });

    it("continues to defer built-in navigation controls", async () => {
        const { harness, paginator } = await createPaginator();
        const collectHandler = vi.fn((interaction: MessageComponentInteraction) => {
            expect(interaction.deferred).toBe(true);
        });
        const interaction = createInteraction("paginator:next");

        vi.spyOn(paginator, "refresh").mockResolvedValue(null);
        paginator.on("collect", collectHandler);
        await harness.collect(interaction);

        expect(interaction.deferUpdate).toHaveBeenCalledOnce();
        expect(collectHandler).toHaveBeenCalledWith(interaction, "first", { chapter: 0, nested: 0 });
    });
});
