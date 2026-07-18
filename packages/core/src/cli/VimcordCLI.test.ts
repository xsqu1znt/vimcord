import { afterEach, describe, expect, it, vi } from "vitest";
import { Vimcord } from "@/client/Vimcord.js";
import { stripAnsi } from "@/utils/Logger.js";
import { isCLIEnabledFor } from "./clientState.js";
import { CLILogger } from "./CLILogger.js";
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
        const beta = new Vimcord({ customId: "beta", client: { intents: [] }, globals: { app: { name: "Beta Bot" } } });
        Object.defineProperty(beta, "user", { configurable: true, value: { tag: "beta.bot#1234" } });
        const cli = setupCLI({ loaders: "never" });

        await cli.execute("/use beta");
        await cli.execute("/stats");

        const rendered = stripAnsi(output.mock.calls.flat().join(" "));
        expect(cli.getSelectedClient()?.id).toBe("beta");
        expect(rendered).toContain("[CLI] Client Selected — Beta Bot / beta.bot#1234");
        expect(rendered).toContain("[CLI] Stats — Beta Bot / beta.bot#1234");
        expect(rendered).not.toContain("beta / Beta Bot");
    });

    it("renders results without surrounding blank lines and includes the Vimcord package version", async () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        new Vimcord({ customId: "main", client: { intents: [] } });
        const cli = setupCLI({ loaders: "never" });

        await cli.execute("/version");

        const firstLine = stripAnsi(String(output.mock.calls[0]?.[0]));
        const rendered = stripAnsi(output.mock.calls.flat().join(" "));
        expect(firstLine).toBe("[CLI] Version — Discord Bot");
        expect(rendered).toContain("Vimcord");
        expect(output.mock.calls.every(call => call[0] !== "")).toBe(true);
    });

    it("wraps tables instead of expanding beyond the useful terminal width", () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const logger = new CLILogger("never");

        logger.table(
            [
                { key: "command", label: "Command" },
                { key: "usage", label: "Usage" },
                { key: "description", label: "Description" }
            ],
            [
                {
                    command: "/example",
                    usage: "/example <a-very-long-value> [--with several optional arguments]",
                    description:
                        "This deliberately long description should wrap cleanly instead of forcing a very wide table."
                }
            ]
        );

        const lines = stripAnsi(String(output.mock.calls[0]?.[0])).split("\n");
        expect(lines.length).toBeGreaterThan(3);
        expect(lines.every(line => line.length <= 110)).toBe(true);
    });

    it("shows whether a fetched user is bot staff", async () => {
        const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const client = new Vimcord({ customId: "main", client: { intents: [] } });
        const cli = setupCLI({ loaders: "never" });
        const user = {
            id: "563488053893791745",
            username: "staff-user",
            globalName: "Staff User",
            tag: "staff-user#1234",
            bot: false,
            system: false,
            createdAt: new Date("2020-01-01T00:00:00.000Z"),
            displayAvatarURL: () => "https://cdn.discordapp.com/avatar.webp"
        } as unknown as NonNullable<Awaited<ReturnType<typeof client.fetchUser>>>;
        vi.spyOn(client, "fetchUser").mockResolvedValue(user);
        const isBotStaff = vi.spyOn(client, "isBotStaff").mockResolvedValue(true);

        await cli.execute(`/userinfo ${user.id}`);

        expect(isBotStaff).toHaveBeenCalledWith(user.id);
        expect(stripAnsi(output.mock.calls.flat().join(" "))).toMatch(/Bot staff\s+Yes/);
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
        expect(stripAnsi(output.mock.calls.flat().join(" "))).toContain("— Discord Bot");

        await cli.execute("/register global --name ping");
        await cli.execute("/register global --names");
        expect(push).toHaveBeenCalledTimes(1);

        await cli.execute("/unregister global");
        expect(pull).not.toHaveBeenCalled();

        await cli.execute("/unregister global --confirm");
        expect(pull).toHaveBeenCalledTimes(1);
    });
});
