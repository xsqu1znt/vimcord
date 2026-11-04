import type { VimcordClientOptions } from "./Vimcord.js";

import EventEmitter from "node:events";
import { Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VimcordPlugin } from "@/plugins/Plugin.js";
import { getGlobalUxConfig, resolveGlobalEmbedColor } from "@/ux/uxConfig.js";
import { Vimcord } from "./Vimcord.js";

let client: Vimcord | undefined;

function createClient(options: Partial<VimcordClientOptions> = {}): Vimcord {
    client = new Vimcord({ intents: [], disableBanner: true, ...options });
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
        const plugin = new RecordingPlugin("failing", { failUninstall: true });
        const client = createClient({ plugins: [plugin] });
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
        const plugin = new RecordingPlugin("service");
        const client = createClient({ plugins: [plugin] });
        vi.spyOn(Client.prototype, "login").mockRejectedValue(new Error("network down"));

        await expect(client.login("token")).rejects.toThrow(/network down/);

        expect(plugin.installCalls).toBe(1);
        expect(plugin.uninstallCalls).toBe(1);
        expect(client.plugins.isInstalled(plugin.name)).toBe(false);
    });

    it("keeps the login failure as the primary error even when plugin cleanup also fails", async () => {
        const plugin = new RecordingPlugin("service", { failUninstall: true });
        const client = createClient({ plugins: [plugin] });
        vi.spyOn(Client.prototype, "login").mockRejectedValue(new Error("network down"));

        await expect(client.login("token")).rejects.toThrow(/network down/);
        expect(client.plugins.isInstalled(plugin.name)).toBe(false);
    });
});

describe("Vimcord.login startup", () => {
    it("runs plugins, the plugin step, modules, listeners, then the gateway, in that order", async () => {
        const order: string[] = [];
        const installed: boolean[] = [];
        class Step extends RecordingPlugin {
            override install(): void {
                order.push(`install:${this.name}`);
            }
            override onPluginsInstalled(): void {
                order.push(`step:${this.name}`);
                installed.push(client!.plugins.isInstalled("a") && client!.plugins.isInstalled("b"));
            }
        }
        const client = createClient({
            plugins: [new Step("a"), new Step("b")],
            modules: {},
            prefix: "!"
        });
        vi.spyOn(client.modules, "load").mockImplementation(async () => {
            order.push("modules");
        });
        vi.spyOn(Client.prototype, "login").mockImplementation(async () => {
            order.push(`gateway:${client.listenerCount("interactionCreate")}:${client.listenerCount("messageCreate")}`);
            return "token";
        });

        await client.login("token");

        expect(order).toEqual(["install:a", "install:b", "step:a", "step:b", "modules", "gateway:1:1"]);
        expect(installed).toEqual([true, true]);
    });

    it("rejects a missing token before running the plugin step", async () => {
        const step = vi.fn();
        class Step extends RecordingPlugin {
            override onPluginsInstalled(): void {
                step();
            }
        }
        const client = createClient({ plugins: [new Step("a")] });
        vi.stubEnv("TOKEN", "");
        vi.stubEnv("TOKEN_DEV", "");

        await expect(client.login()).rejects.toThrow(/TOKEN Missing/);

        expect(step).not.toHaveBeenCalled();
        vi.unstubAllEnvs();
    });

    it("uninstalls every plugin when the plugin step fails, and can retry with the same plugins", async () => {
        let fail = true;
        class Step extends RecordingPlugin {
            override onPluginsInstalled(): void {
                if (fail) throw new Error("migration failed");
            }
        }
        const first = new RecordingPlugin("first");
        const failing = new Step("failing");
        const client = createClient({ plugins: [first, failing] });
        const gateway = vi.spyOn(Client.prototype, "login").mockResolvedValue("token");

        const error = (await client.login("token").catch(e => e)) as Error;

        expect(error.message).toMatch(/migration failed/);
        expect(error.cause).toBeInstanceOf(Error);
        expect(gateway).not.toHaveBeenCalled();
        expect(first.uninstallCalls).toBe(1);
        expect(failing.uninstallCalls).toBe(1);

        fail = false;
        await client.login("token");
        expect(first.installCalls).toBe(2);
        expect(gateway).toHaveBeenCalledOnce();
    });

    it("refuses a second login without tearing down the running client", async () => {
        const plugin = new RecordingPlugin("service");
        const client = createClient({ plugins: [plugin] });
        vi.spyOn(Client.prototype, "login").mockResolvedValue("token");
        await client.login("token");

        await expect(client.login("token")).rejects.toThrow(/already called/);

        expect(plugin.uninstallCalls).toBe(0);
        expect(client.plugins.isInstalled("service")).toBe(true);
    });

    it("removes the command listeners on destroy", async () => {
        const client = createClient({ prefix: "!" });
        vi.spyOn(Client.prototype, "login").mockResolvedValue("token");
        await client.login("token");
        expect(client.listenerCount("messageCreate")).toBe(1);

        await client.destroy();

        expect(client.listenerCount("interactionCreate")).toBe(0);
        expect(client.listenerCount("messageCreate")).toBe(0);
    });

    it("strips Vimcord settings before configuring Discord.js", () => {
        const client = createClient({ name: "Bot", staff: { ownerId: "1" }, closeTimeout: 1234 });
        expect(client.options).toMatchObject({ closeTimeout: 1234 });
        expect(client.options).not.toHaveProperty("name");
        expect(client.options).not.toHaveProperty("staff");
        expect(client.$name).toBe("Bot");
        expect(client.globals.staff.ownerId).toBe("1");
    });
});

describe("Vimcord command sync", () => {
    function createSyncClient(options: Partial<VimcordClientOptions> = {}) {
        const client = createClient(options);
        const commands = client.modules.commands;
        const push = vi.spyOn(commands, "push").mockResolvedValue(true);
        vi.spyOn(commands, "getAllAppCommands").mockReturnValue([{ registration: { global: true } }] as never);
        return { client, push };
    }

    it("syncs once the client is ready, and not before", () => {
        const { client, push } = createSyncClient();
        expect(push).not.toHaveBeenCalled();
        (client as unknown as EventEmitter).emit("clientReady");
        expect(push).toHaveBeenCalledOnce();
    });

    it("skips syncing with syncCommands: false", () => {
        const { client, push } = createSyncClient({ syncCommands: false });
        (client as unknown as EventEmitter).emit("clientReady");
        expect(push).not.toHaveBeenCalled();
    });

    it("logs a sync failure instead of raising it", async () => {
        const { client, push } = createSyncClient();
        const logged = vi.spyOn(client.logger, "error").mockImplementation(() => {});
        push.mockRejectedValue(new Error("rest down"));
        (client as unknown as EventEmitter).emit("clientReady");
        await new Promise(resolve => setImmediate(resolve));
        expect(logged).toHaveBeenCalledOnce();
    });
});

describe("Vimcord dev mode", () => {
    afterEach(() => {
        getGlobalUxConfig().devMode = false;
        getGlobalUxConfig().embedColor = null;
        getGlobalUxConfig().embedColorDev = null;
    });

    it("applies embedColorDev from the constructor option and the $devMode setter", () => {
        getGlobalUxConfig().embedColor = "#111111";
        getGlobalUxConfig().embedColorDev = "#222222";

        const client = createClient({ devMode: true });
        expect(resolveGlobalEmbedColor()).toBe("#222222");

        client.$devMode = false;
        expect(resolveGlobalEmbedColor()).toBe("#111111");
    });
});
