import type { Vimcord } from "./Vimcord.js";

import { ActivityType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { StatusManager } from "./StatusManager.js";

function createStatusManager(devMode: boolean): {
    manager: StatusManager;
    setActivity: ReturnType<typeof vi.fn>;
} {
    const setActivity = vi.fn();
    let client: Record<string, unknown>;
    client = {
        $devMode: devMode,
        on: vi.fn(),
        off: vi.fn(),
        logger: {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        },
        isReady: () => true,
        awaitReady: async () => client as unknown as Vimcord,
        user: {
            setStatus: vi.fn(),
            setActivity
        },
        users: { cache: { size: 0 } },
        guilds: { cache: { size: 0 } },
        globals: {
            staff: {
                guild: { id: null, inviteUrl: null }
            }
        },
        fetchGuild: vi.fn()
    };

    return {
        manager: new StatusManager(client as unknown as Vimcord),
        setActivity
    };
}

describe("StatusManager.set", () => {
    it("accepts one shared profile without environment wrappers", async () => {
        const { manager, setActivity } = createStatusManager(false);

        await manager.set({ activity: { name: "Shared", type: ActivityType.Custom } });

        expect(setActivity).toHaveBeenCalledWith(expect.objectContaining({ name: "Shared" }));
    });

    it("clears the activity when the current environment profile is omitted", async () => {
        const { manager, setActivity } = createStatusManager(true);

        await manager.set({
            production: { activity: { name: "Production only", type: ActivityType.Custom } }
        });

        expect(setActivity).toHaveBeenCalledTimes(1);
        expect(setActivity.mock.calls[0]).toEqual([]);
    });
});
