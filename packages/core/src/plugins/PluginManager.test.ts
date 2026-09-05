import type { Vimcord } from "@/client/Vimcord.js";

import { describe, expect, it } from "vitest";
import { VimcordPlugin } from "./Plugin.js";
import { PluginManager } from "./PluginManager.js";

class TestPlugin extends VimcordPlugin {
    name: string;
    description = "Test plugin";
    version = "1.0.0";

    constructor(
        name: string,
        readonly attempts: string[],
        readonly fail = false
    ) {
        super();
        this.name = name;
    }

    install(): void {}

    uninstall(): void {
        this.attempts.push(this.name);
        if (this.fail) throw new Error(`${this.name} failed`);
    }
}

describe("PluginManager", () => {
    it("continues reverse-order cleanup after a plugin uninstall fails", async () => {
        const attempts: string[] = [];
        const manager = new PluginManager({} as Vimcord);
        const dependency = new TestPlugin("dependency", attempts);
        const dependent = new TestPlugin("dependent", attempts, true);
        dependent.dependencies = [dependency.name];
        dependency.installed = true;
        dependent.installed = true;

        manager.use(dependency);
        manager.use(dependent);

        await expect(manager.unload()).rejects.toThrow(AggregateError);
        expect(attempts).toEqual(["dependent", "dependency"]);
        expect(manager.getAll()).toEqual([]);
    });
});
