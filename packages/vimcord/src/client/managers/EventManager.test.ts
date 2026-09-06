import type { ClientEvents } from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";

import EventEmitter from "node:events";
import { describe, expect, it, vi } from "vitest";
import { EventManager } from "./EventManager.js";

function createClient(): EventEmitter {
    const client = new EventEmitter() as EventEmitter & {
        logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
    client.logger = { debug: vi.fn(), error: vi.fn() };
    return client;
}

function createEvent(
    id: string,
    options: { once?: boolean; run: () => Promise<void> | void }
): Parameters<EventManager["register"]>[0] {
    return {
        id,
        name: id,
        event: "messageCreate",
        once: options.once ?? false,
        metadata: {},
        inject: vi.fn(),
        run: options.run
    } as unknown as Parameters<EventManager["register"]>[0];
}

describe("EventManager", () => {
    it("consumes once handlers before a reentrant emission", async () => {
        const client = createClient();
        const manager = new EventManager(client as unknown as Vimcord);
        const calls: string[] = [];

        manager.register(
            createEvent("once", {
                once: true,
                run: () => {
                    calls.push("once");
                    client.emit("messageCreate", {});
                }
            }),
            createEvent("persistent", {
                run: () => {
                    calls.push("persistent");
                }
            })
        );

        await manager.executeEvents("messageCreate", {} as ClientEvents["messageCreate"][0]);
        await new Promise(resolve => setImmediate(resolve));

        expect(calls.filter(call => call === "once")).toHaveLength(1);
        expect(calls.filter(call => call === "persistent")).toHaveLength(2);
    });

    it("consumes once handlers before overlapping emissions", async () => {
        const client = createClient();
        const manager = new EventManager(client as unknown as Vimcord);
        let release!: () => void;
        const running = new Promise<void>(resolve => {
            release = resolve;
        });
        const run = vi.fn(async () => running);

        manager.register(createEvent("once", { once: true, run }));

        const first = manager.executeEvents("messageCreate", {} as ClientEvents["messageCreate"][0]);
        const second = manager.executeEvents("messageCreate", {} as ClientEvents["messageCreate"][0]);
        release();
        await Promise.all([first, second]);

        expect(run).toHaveBeenCalledTimes(1);
    });
});
