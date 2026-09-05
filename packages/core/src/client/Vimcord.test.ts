import EventEmitter from "node:events";
import { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VimcordPlugin } from "@/plugins/Plugin.js";
import { Vimcord } from "./Vimcord.js";

let client: Vimcord | undefined;

function createClient(): Vimcord {
    client = new Vimcord({ client: { intents: [] } });
    client.logger.clientReady = vi.fn();
    return client;
}

class FailingPlugin extends VimcordPlugin {
    name = "failing";
    description = "Fails during cleanup";
    version = "1.0.0";

    install(): void {}

    uninstall(): void {
        throw new Error("cleanup failed");
    }
}

afterEach(async () => {
    await client?.destroy();
    client = undefined;
});

describe("Vimcord.awaitReady", () => {
    it("gives callers independent deadlines and removes the shared listener after timeout", async () => {
        const client = createClient();
        const baseline = client.listenerCount("clientReady");
        const shortWait = client.awaitReady(1);
        const longWait = client.awaitReady(20);

        expect(client.listenerCount("clientReady")).toBe(baseline + 1);
        await expect(shortWait).resolves.toBe(false);
        expect(client.listenerCount("clientReady")).toBe(baseline + 1);
        await expect(longWait).resolves.toBe(false);
        expect(client.listenerCount("clientReady")).toBe(baseline);
    });

    it("settles concurrent waiters from one ready listener", async () => {
        const client = createClient();
        const baseline = client.listenerCount("clientReady");
        const waits = [client.awaitReady(), client.awaitReady(), client.awaitReady()];
        expect(client.listenerCount("clientReady")).toBe(baseline + 1);

        (client as unknown as EventEmitter).emit("clientReady");
        await expect(Promise.all(waits)).resolves.toEqual([true, true, true]);
        expect(client.listenerCount("clientReady")).toBe(1);
    });

    it("finishes client cleanup after a plugin uninstall failure", async () => {
        const client = createClient();
        const plugin = new FailingPlugin();
        plugin.installed = true;
        client.use(plugin);

        const wait = client.awaitReady();
        const destroyed = vi.fn();
        const destroyClient = vi.spyOn(Client.prototype, "destroy");
        Vimcord.$events.once("destroy", destroyed);

        await expect(client.destroy()).rejects.toThrow(AggregateError);

        await expect(wait).resolves.toBe(false);
        expect(destroyClient).toHaveBeenCalled();
        expect(Vimcord.getInstance()).toBeUndefined();
        expect(destroyed).toHaveBeenCalledWith(client);
    });
});
