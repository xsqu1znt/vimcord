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

class RecordingPlugin extends VimcordPlugin {
    name: string;
    description = "Records install/uninstall calls";
    version = "1.0.0";
    installCalls = 0;
    uninstallCalls = 0;

    constructor(
        name: string,
        private readonly options: { failInstall?: boolean; failUninstall?: boolean } = {}
    ) {
        super();
        this.name = name;
    }

    override install(): void {
        this.installCalls++;
        if (this.options.failInstall) throw new Error(`${this.name} install failed`);
    }

    override uninstall(): void {
        this.uninstallCalls++;
        if (this.options.failUninstall) throw new Error(`${this.name} uninstall failed`);
    }
}

afterEach(async () => {
    await client?.destroy();
    client = undefined;
    vi.restoreAllMocks();
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
        const plugin = new RecordingPlugin("failing", { failUninstall: true });
        client.use(plugin);
        await client.plugins.load();

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

describe("Vimcord.login plugin cleanup", () => {
    it("cleans up already-installed plugins when a later login step fails", async () => {
        const client = createClient();
        const plugin = new RecordingPlugin("service");
        client.use(plugin);
        vi.spyOn(Client.prototype, "login").mockRejectedValue(new Error("network down"));

        await expect(client.login("token")).rejects.toThrow(/network down/);

        expect(plugin.installCalls).toBe(1);
        expect(plugin.uninstallCalls).toBe(1);
        expect(client.plugins.isInstalled(plugin.name)).toBe(false);
    });

    it("keeps the login failure as the primary error even when plugin cleanup also fails", async () => {
        const client = createClient();
        const plugin = new RecordingPlugin("service", { failUninstall: true });
        client.use(plugin);
        vi.spyOn(Client.prototype, "login").mockRejectedValue(new Error("network down"));

        await expect(client.login("token")).rejects.toThrow(/network down/);
        expect(client.plugins.isInstalled(plugin.name)).toBe(false);
    });
});
