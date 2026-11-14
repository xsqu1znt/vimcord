import type { Vimcord } from "./Vimcord.js";

import EventEmitter from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusManager } from "./StatusManager.js";

function createClient() {
    return Object.assign(new EventEmitter(), {
        $devMode: false,
        awaitReady: vi.fn().mockResolvedValue(true),
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
        user: { setActivity: vi.fn(), setPresence: vi.fn() }
    });
}

function createManager() {
    const client = createClient();
    const manager = new StatusManager(client as unknown as Vimcord);
    return { client, manager };
}

afterEach(() => vi.useRealTimers());

describe("StatusManager", () => {
    it("resolves synchronous and async names with the ready client and logs the resolved name", async () => {
        const { client, manager } = createManager();
        const name = vi.fn(() => "Current count");
        await manager.set({ activity: { name, url: "https://example.com/stream" } });
        expect(name).toHaveBeenCalledExactlyOnceWith(client);
        expect(client.user.setPresence).toHaveBeenLastCalledWith({
            status: "online",
            activities: [{ name: "Current count", url: "https://example.com/stream" }],
            shardId: undefined
        });
        expect(client.logger.debug).toHaveBeenCalledWith("[StatusManager] Status changed to 'Current count'");
        await manager.set({ activity: { name: async () => "Async count" } });
        expect(client.user.setPresence).toHaveBeenLastCalledWith(
            expect.objectContaining({ activities: [{ name: "Async count" }] })
        );
    });

    it("refreshes a single function name, supports pause/start, and leaves string names alone", async () => {
        vi.useFakeTimers();
        const { client, manager } = createManager();
        let count = 0;
        const name = vi.fn(() => String(++count));
        await manager.set({ interval: 100, activity: { name } });
        await vi.advanceTimersByTimeAsync(200);
        expect(name).toHaveBeenCalledTimes(3);
        expect(client.user.setPresence).toHaveBeenLastCalledWith(expect.objectContaining({ activities: [{ name: "3" }] }));
        manager.pause();
        await vi.advanceTimersByTimeAsync(100);
        expect(name).toHaveBeenCalledTimes(3);
        manager.start();
        await vi.advanceTimersByTimeAsync(100);
        expect(name).toHaveBeenCalledTimes(4);
        await manager.set({ interval: 100, activity: { name: "Static" } });
        const calls = client.user.setPresence.mock.calls.length;
        manager.start();
        await vi.advanceTimersByTimeAsync(300);
        expect(client.user.setPresence).toHaveBeenCalledTimes(calls);
        await manager.destroy();
        expect(client.listenerCount("clientReady")).toBe(0);
    });

    it.each([false, true])("keeps the presence and continues rotating after a name failure (async=%s)", async asyncName => {
        vi.useFakeTimers();
        const { client, manager } = createManager();
        const error = new Error("name failed");
        const fail = () => {
            throw error;
        };
        await manager.set({
            interval: 100,
            activity: [{ name: "First" }, { name: asyncName ? async () => fail() : fail }, { name: "Third" }]
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(client.logger.error).toHaveBeenCalledWith("[StatusManager] Failed to resolve activity name", error);
        expect(client.user.setPresence).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(client.user.setPresence).toHaveBeenLastCalledWith(
            expect.objectContaining({ activities: [{ name: "Third" }] })
        );
        await manager.destroy();
    });

    it("starts refreshing even when the first name fails", async () => {
        vi.useFakeTimers();
        const { client, manager } = createManager();
        const name = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue("Recovered");
        await manager.set({ interval: 100, activity: { name } });
        await vi.advanceTimersByTimeAsync(100);
        expect(client.user.setPresence).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ activities: [{ name: "Recovered" }] })
        );
        await manager.destroy();
    });

    it.each(["set", "clear"] as const)("does not apply an in-flight name after a newer %s", async action => {
        const { client, manager } = createManager();
        let resolveName!: (name: string) => void;
        const pending = new Promise<string>(resolve => {
            resolveName = resolve;
        });
        const name = vi.fn(() => pending);
        const setting = manager.set({ interval: 100, activity: { name } });
        await vi.waitFor(() => expect(name).toHaveBeenCalled());
        if (action === "set") await manager.set({ activity: { name: "New" } });
        else await manager.clear();
        resolveName("Stale");
        await setting;
        expect(client.user.setPresence).toHaveBeenCalledTimes(action === "set" ? 1 : 0);
        if (action === "set")
            expect(client.user.setPresence).toHaveBeenLastCalledWith(
                expect.objectContaining({ activities: [{ name: "New" }] })
            );
        await manager.destroy();
    });

    it("keeps literal placeholders and chooses the current environment profile", async () => {
        const { client, manager } = createManager();
        await manager.set({
            production: { activity: { name: "$USER_COUNT $GUILD_COUNT $INVITE $STAFF_GUILD_MEMBER_COUNT" } }
        });
        expect(client.user.setPresence).toHaveBeenLastCalledWith(
            expect.objectContaining({ activities: [{ name: "$USER_COUNT $GUILD_COUNT $INVITE $STAFF_GUILD_MEMBER_COUNT" }] })
        );
        client.$devMode = true;
        await manager.set({ production: { activity: { name: "Production" } } });
        expect(client.user.setActivity).toHaveBeenCalledOnce();
    });
});
