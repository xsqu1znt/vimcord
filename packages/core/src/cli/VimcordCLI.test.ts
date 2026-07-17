import { afterEach, describe, expect, it, vi } from "vitest";
import { Vimcord } from "@/client/Vimcord.js";
import { stripAnsi } from "@/utils/Logger.js";
import { isCLIEnabledFor } from "./clientState.js";
import { getCLI, setupCLI } from "./setupCLI.js";

afterEach(() => {
    getCLI()?.stop();
    Vimcord.$instances.clear();
    vi.restoreAllMocks();
});

describe("setupCLI", () => {
    it("attaches default-enabled clients created before and after setup", () => {
        const first = new Vimcord({ customId: "first", client: { intents: [] } });
        const cli = setupCLI({ loaders: "never" });
        const second = new Vimcord({ customId: "second", client: { intents: [] } });

        expect(first.globals.app.enableCLI).toBe(true);
        expect(cli.getClients()).toEqual([first, second]);
        expect(cli.getSelectedClient()).toBe(first);
        expect(isCLIEnabledFor(first)).toBe(true);
        expect(isCLIEnabledFor(second)).toBe(true);
    });

    it("excludes opted-out clients and reacts to runtime configuration changes", () => {
        const client = new Vimcord({
            customId: "private",
            client: { intents: [] },
            globals: { app: { enableCLI: false } }
        });
        const cli = setupCLI({ loaders: "never" });

        expect(cli.getClients()).toEqual([]);
        expect(isCLIEnabledFor(client)).toBe(false);

        client.configure({ app: { enableCLI: true } });
        expect(cli.getClients()).toEqual([client]);

        client.configure({ app: { enableCLI: false } });
        expect(cli.getClients()).toEqual([]);
    });

    it("prevents duplicate process runtimes and permits setup after stopping", () => {
        const cli = setupCLI({ loaders: "never" });
        expect(() => setupCLI()).toThrow("already been initialized");

        cli.stop();
        expect(setupCLI({ loaders: "never" })).not.toBe(cli);
    });
});

describe("VimcordCLI commands", () => {
    it("selects clients and identifies the target in command output", async () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        new Vimcord({ customId: "alpha", client: { intents: [] }, globals: { app: { name: "Alpha Bot" } } });
        new Vimcord({ customId: "beta", client: { intents: [] }, globals: { app: { name: "Beta Bot" } } });
        const cli = setupCLI({ loaders: "never" });

        await cli.execute("/use beta");
        await cli.execute("/stats");

        const rendered = stripAnsi(output.mock.calls.flat().join(" "));
        expect(cli.getSelectedClient()?.id).toBe("beta");
        expect(rendered).toContain("[CLI] Client Selected — beta / Beta Bot");
        expect(rendered).toContain("[CLI] Stats — beta / Beta Bot");
    });

    it("routes command deployment and requires confirmation before unregistering", async () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const client = new Vimcord({ customId: "main", client: { intents: [] } });
        const cli = setupCLI({ loaders: "never" });
        const command = { registration: { global: true } };
        vi.spyOn(client.modules.commands, "getAllAppCommands").mockReturnValue([command] as unknown as ReturnType<
            typeof client.modules.commands.getAllAppCommands
        >);
        const push = vi.spyOn(client.modules.commands, "push").mockResolvedValue(true);
        const pull = vi.spyOn(client.modules.commands, "pull").mockResolvedValue(true);

        await cli.execute("/register global --names ping stats");
        expect(push).toHaveBeenCalledWith({ names: ["ping", "stats"], category: undefined, tag: undefined });
        expect(stripAnsi(output.mock.calls.flat().join(" "))).toContain("— main / Discord Bot");

        await cli.execute("/register global --name ping");
        await cli.execute("/register global --names");
        expect(push).toHaveBeenCalledTimes(1);

        await cli.execute("/unregister global");
        expect(pull).not.toHaveBeenCalled();

        await cli.execute("/unregister global --confirm");
        expect(pull).toHaveBeenCalledTimes(1);
    });
});
