import type { Vimcord } from "../Vimcord.js";

import { Collection, Routes } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { CommandManager } from "./CommandManager.js";

function createClient() {
    return {
        user: { id: "app" },
        isReady: () => true,
        awaitReady: async () => true,
        guilds: { cache: new Collection(Array.from({ length: 12 }, (_, i) => [`guild-${i}`, { id: `guild-${i}` }])) },
        logger: { module: vi.fn(), debug: vi.fn(), error: vi.fn() },
        rest: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), patch: vi.fn(), put: vi.fn() }
    };
}

function command(name: string, guilds?: string[]) {
    return { builder: { toJSON: vi.fn(() => ({ name, description: "d", type: 1 as const })) }, registration: { guilds } };
}

describe("CommandManager registration preparation", () => {
    it("builds once per sync, targets guilds within bounded workers, and keeps unrelated remote commands", async () => {
        const client = createClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        const all = command("all");
        const targeted = command("targeted", ["guild-0"]);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([all, targeted] as never);
        let inFlight = 0;
        let maximum = 0;
        client.rest.get.mockImplementation(async () => {
            maximum = Math.max(maximum, ++inFlight);
            await new Promise(r => setImmediate(r));
            inFlight--;
            return [
                { id: "unchanged", name: "all", description: "d", type: 1 },
                { id: "unrelated", name: "remote", type: 1 }
            ];
        });
        expect(await manager.pushByGuild()).toBe(true);
        expect(all.builder.toJSON).toHaveBeenCalledOnce();
        expect(targeted.builder.toJSON).toHaveBeenCalledOnce();
        expect(maximum).toBeLessThanOrEqual(5);
        expect(maximum).toBeGreaterThan(1);
        expect(client.rest.patch).not.toHaveBeenCalled();
        expect(client.rest.put).not.toHaveBeenCalled();
        expect(client.rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild-0"), {
            body: { name: "targeted", description: "d", type: 1 }
        });
        await manager.pushByGuild({ guilds: ["guild-1"] });
        expect(all.builder.toJSON).toHaveBeenCalledTimes(2);
        expect(targeted.builder.toJSON).toHaveBeenCalledTimes(2);
    });

    it("patches by existing identity without replacing unchanged commands or deleting unrelated commands", async () => {
        const client = createClient();
        const manager = new CommandManager(client as unknown as Vimcord);
        vi.spyOn(manager, "getAllAppCommands").mockReturnValue([command("changed"), command("new")] as never);
        client.rest.get.mockResolvedValue([{ id: "same-id", name: "changed", description: "old", type: 1 }] as never);
        await manager.pushByGuild({ guilds: ["guild-0"] });
        expect(client.rest.patch).toHaveBeenCalledWith(Routes.applicationGuildCommand("app", "guild-0", "same-id"), {
            body: { name: "changed", description: "d", type: 1 }
        });
        expect(client.rest.post).toHaveBeenCalledWith(Routes.applicationGuildCommands("app", "guild-0"), {
            body: { name: "new", description: "d", type: 1 }
        });
        expect(client.rest.put).not.toHaveBeenCalled();
    });
});
