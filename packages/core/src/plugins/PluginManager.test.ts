import type { VimcordPluginContext } from "./Plugin.js";

import { afterEach, describe, expect, it } from "vitest";
import { collectClientHealth } from "@/cli/health.js";
import { Vimcord } from "@/client/Vimcord.js";
import { VimcordPlugin } from "./Plugin.js";

class ContributionPlugin extends VimcordPlugin {
    override name = "contributions";
    override description = "Test contributions";
    override version = "1.0.0";

    override install({ cli, health }: VimcordPluginContext): void {
        cli.registerCommand({
            name: "hello",
            description: "Says hello",
            execute: ({ logger }) => logger.line("Hello")
        });
        health.register({
            id: "test-service",
            label: "Test Service",
            check: () => ({ status: "healthy", latencyMs: 2 })
        });
    }

    override uninstall(): void {
        // Contributions are removed by PluginManager after this hook completes.
    }
}

class ReservedCommandPlugin extends VimcordPlugin {
    override name = "reserved";
    override description = "Registers an invalid command";
    override version = "1.0.0";

    override install({ cli }: VimcordPluginContext): void {
        cli.registerCommand({ name: "help", description: "Collision", execute: () => undefined });
    }

    override uninstall(): void {}
}

afterEach(() => {
    Vimcord.$instances.clear();
});

describe("PluginManager contributions", () => {
    it("registers client-scoped CLI commands and health probes and removes them on unload", async () => {
        const client = new Vimcord({ customId: "plugins", client: { intents: [] } });
        client.use(new ContributionPlugin());

        await client.plugins.load();
        expect(client.plugins.getCLICommands().map(entry => entry.command.name)).toEqual(["hello"]);
        expect(client.plugins.getHealthProbes().map(entry => entry.probe.id)).toEqual(["test-service"]);

        const health = await collectClientHealth(client, new AbortController().signal);
        expect(health[0]?.result).toEqual({ status: "healthy", latencyMs: 2 });

        await client.plugins.unload("contributions");
        expect(client.plugins.getCLICommands()).toEqual([]);
        expect(client.plugins.getHealthProbes()).toEqual([]);
    });

    it("prevents plugins from replacing core CLI commands", async () => {
        const client = new Vimcord({ customId: "reserved", client: { intents: [] } });
        client.use(new ReservedCommandPlugin());

        await expect(client.plugins.load()).rejects.toThrow("cannot replace core CLI command '/help'");
        expect(client.plugins.getCLICommands()).toEqual([]);
    });

    it("isolates rejected health checks", async () => {
        class BrokenHealthPlugin extends VimcordPlugin {
            override name = "broken-health";
            override description = "Broken test probe";
            override version = "1.0.0";
            override install({ health }: VimcordPluginContext): void {
                health.register({
                    id: "broken",
                    label: "Broken",
                    check: () => {
                        throw new Error("Service offline");
                    }
                });
            }
            override uninstall(): void {}
        }

        const client = new Vimcord({ customId: "health", client: { intents: [] } });
        client.use(new BrokenHealthPlugin());
        await client.plugins.load();

        const health = await collectClientHealth(client, new AbortController().signal);
        expect(health[0]?.result).toEqual({ status: "unavailable", detail: "Service offline" });
    });

    it("times out health providers without blocking the aggregate result", async () => {
        class SlowHealthPlugin extends VimcordPlugin {
            override name = "slow-health";
            override description = "Slow test probe";
            override version = "1.0.0";
            override install({ health }: VimcordPluginContext): void {
                health.register({
                    id: "slow",
                    label: "Slow",
                    timeout: 5,
                    check: async () => await new Promise<never>(() => undefined)
                });
            }
            override uninstall(): void {}
        }

        const client = new Vimcord({ customId: "slow-health", client: { intents: [] } });
        client.use(new SlowHealthPlugin());
        await client.plugins.load();

        const health = await collectClientHealth(client, new AbortController().signal);
        expect(health[0]?.result).toEqual({ status: "unavailable", detail: "Timed out" });
    });
});
