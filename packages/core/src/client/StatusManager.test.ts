import type { Vimcord } from "./Vimcord.js";

import EventEmitter from "node:events";
import { describe, expect, it, vi } from "vitest";
import { StatusManager } from "./StatusManager.js";

function createClient() {
    const client = new EventEmitter() as EventEmitter & {
        awaitReady: ReturnType<typeof vi.fn>;
        fetchGuild: ReturnType<typeof vi.fn>;
        globals: Vimcord["globals"];
        guilds: { cache: Map<string, unknown> };
        isReady: () => boolean;
        logger: { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
        user: { setActivity: ReturnType<typeof vi.fn>; setPresence: ReturnType<typeof vi.fn> };
        users: { cache: Map<string, unknown> };
    };
    client.awaitReady = vi.fn().mockResolvedValue(true);
    client.fetchGuild = vi.fn();
    client.globals = { staff: { guild: {} } } as Vimcord["globals"];
    client.guilds = { cache: new Map() };
    client.isReady = () => true;
    client.logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    client.user = { setActivity: vi.fn(), setPresence: vi.fn() };
    client.users = { cache: new Map() };
    return client;
}

describe("StatusManager", () => {
    it("applies an activity and status in one presence update", async () => {
        const client = createClient();
        const manager = new StatusManager(client as unknown as Vimcord);

        await manager.set({ activity: { name: "Watching", shardId: [2], status: "idle" } });

        expect(client.user.setPresence).toHaveBeenCalledTimes(1);
        expect(client.user.setPresence).toHaveBeenCalledWith({
            status: "idle",
            activities: [{ name: "Watching", url: undefined }],
            shardId: [2]
        });
        expect(client.user.setActivity).not.toHaveBeenCalled();
    });

    it("does not apply a stale formatted activity after clear", async () => {
        const client = createClient();
        let resolveGuild!: () => void;
        const guild = new Promise<void>(resolve => {
            resolveGuild = resolve;
        });
        client.globals.staff.guild.id = "staff";
        client.fetchGuild.mockImplementation(() => guild.then(() => ({ memberCount: 1 })));
        const manager = new StatusManager(client as unknown as Vimcord);

        const setting = manager.set({ activity: { name: "$STAFF_GUILD_MEMBER_COUNT" } });
        await new Promise(resolve => setImmediate(resolve));
        await manager.clear();
        resolveGuild();
        await setting;

        expect(client.user.setPresence).not.toHaveBeenCalled();
        expect(client.user.setActivity).toHaveBeenCalledTimes(1);
    });
});
