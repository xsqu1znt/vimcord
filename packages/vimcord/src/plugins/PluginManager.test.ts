import type { Vimcord } from "@/client/Vimcord.js";
import type { VimcordPluginContext } from "./Plugin.js";

import { describe, expect, it, vi } from "vitest";
import { VimcordPlugin } from "./Plugin.js";
import { PluginManager } from "./PluginManager.js";

function createClient(): Vimcord {
    return {
        $name: "TestBot",
        logger: { debug: vi.fn(), plugin: { error: vi.fn() } }
    } as unknown as Vimcord;
}

class TestPlugin extends VimcordPlugin {
    name: string;

    constructor(
        name: string,
        readonly attempts: string[],
        readonly fail = false
    ) {
        super();
        this.name = name;
    }

    override install(): void {}

    override uninstall(): void {
        this.attempts.push(this.name);
        if (this.fail) throw new Error(`${this.name} failed`);
    }
}

class HealthPlugin extends VimcordPlugin {
    name = "health";
    uninstallCalls = 0;

    override install({ health }: VimcordPluginContext): void {
        health.register({ id: "svc", label: "Service", check: () => ({ status: "healthy" }) });
        throw new Error("install failed after registering health");
    }

    override uninstall(): void {
        this.uninstallCalls++;
    }
}

describe("PluginManager", () => {
    it("installs dependencies before dependents and unloads in reverse order", async () => {
        const attempts: string[] = [];
        const dependency = new TestPlugin("dependency", attempts);
        const dependent = new TestPlugin("dependent", attempts);
        dependent.dependencies = [dependency.name];
        const manager = new PluginManager(createClient(), [dependency, dependent]);

        await manager.load();
        expect(manager.isInstalled("dependency")).toBe(true);
        expect(manager.isInstalled("dependent")).toBe(true);

        await manager.unload();
        expect(attempts).toEqual(["dependent", "dependency"]);
        expect(manager.getAll(true)).toEqual([]);
        expect(manager.getAll()).toEqual([dependency, dependent]);
    });

    it("continues reverse-order cleanup after a plugin uninstall fails", async () => {
        const attempts: string[] = [];
        const dependency = new TestPlugin("dependency", attempts);
        const dependent = new TestPlugin("dependent", attempts, true);
        dependent.dependencies = [dependency.name];
        const manager = new PluginManager(createClient(), [dependency, dependent]);
        await manager.load();

        await expect(manager.unload()).rejects.toThrow(AggregateError);
        expect(attempts).toEqual(["dependent", "dependency"]);
        expect(manager.getAll(true)).toEqual([]);
    });

    it("removes health registrations after a partial install failure and does not clean up twice", async () => {
        const plugin = new HealthPlugin();
        const manager = new PluginManager(createClient(), [plugin]);

        await expect(manager.load()).rejects.toThrow("install failed after registering health");
        expect(plugin.uninstallCalls).toBe(1);
        expect(manager.getHealthProbes()).toEqual([]);
        expect(manager.isInstalled(plugin.name)).toBe(false);

        await manager.unload();
        expect(plugin.uninstallCalls).toBe(1);
    });

    it("drives installed lookups and filtering from manager-owned state", async () => {
        const a = new TestPlugin("a", []);
        const b = new TestPlugin("b", []);
        const manager = new PluginManager(createClient(), [a, b]);

        expect(manager.isInstalled("a")).toBe(false);
        expect(manager.getAll(true)).toEqual([]);
        expect(manager.getAll(false)).toEqual([a, b]);
        expect(() => manager.get("a", true)).toThrow();

        await manager.load();

        expect(manager.isInstalled("a")).toBe(true);
        expect(manager.getAll(true)).toEqual([a, b]);
        expect(manager.getAll(false)).toEqual([]);
        expect(manager.get("a", true)).toBe(a);
    });

    it("resolves dependencies registered in any order and rejects bad registrations at construction", async () => {
        const order: string[] = [];
        class Recording extends TestPlugin {
            override install(): void {
                order.push(this.name);
            }
        }
        const dependency = new Recording("dependency", []);
        const dependent = new Recording("dependent", []);
        dependent.dependencies = ["dependency"];
        await new PluginManager(createClient(), [dependent, dependency]).load();
        expect(order).toEqual(["dependency", "dependent"]);

        expect(() => new PluginManager(createClient(), [dependent])).toThrow(/depends on 'dependency'/);
        expect(() => new PluginManager(createClient(), [dependency, dependency])).toThrow(/already registered/);
    });
});
