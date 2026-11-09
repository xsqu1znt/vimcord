import { afterEach, describe, expect, it, vi } from "vitest";
import { VimcordCLI } from "./VimcordCLI.js";

afterEach(() => vi.restoreAllMocks());

describe("custom CLI commands", () => {
    it("runs custom commands and aliases with parsed arguments and flags", async () => {
        const cli = new VimcordCLI();
        const execute = vi.fn();
        expect(
            cli.addCommand({
                name: "reload-config",
                aliases: ["reload"],
                description: "Reloads config.",
                requiresClient: false,
                execute
            })
        ).toBe(cli);
        await cli.execute("/reload disk --force");
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining({
                cli,
                client: null,
                logger: cli.logger,
                args: ["disk"],
                flags: new Map([["force", []]])
            })
        );
    });

    it("lists custom commands in help and resolves help by alias", async () => {
        const cli = new VimcordCLI();
        const table = vi.spyOn(cli.logger, "table").mockImplementation(() => {});
        const fields = vi.spyOn(cli.logger, "fields").mockImplementation(() => {});
        vi.spyOn(cli.logger, "header").mockImplementation(() => {});
        cli.addCommand({
            name: "reload-config",
            aliases: ["reload"],
            description: "Reloads config.",
            usage: "/reload-config [--force]",
            execute() {}
        });
        await cli.execute("/help");
        expect(table).toHaveBeenCalledWith(
            expect.any(Array),
            expect.arrayContaining([expect.objectContaining({ command: "/reload-config", description: "Reloads config." })])
        );
        await cli.execute("/help reload");
        expect(fields).toHaveBeenCalledWith(expect.arrayContaining([["Usage", "/reload-config [--force]"]]));
    });

    it("rejects collisions between names and aliases, including built-ins", () => {
        const cli = new VimcordCLI();
        const command = { name: "reload", aliases: ["refresh"], description: "Reloads config.", execute() {} };
        cli.addCommand(command);
        for (const collision of [
            { ...command, name: "help", aliases: [] },
            { ...command, name: "refresh", aliases: [] },
            { ...command, name: "other", aliases: ["reload"] },
            { ...command, name: "other", aliases: ["help"] },
            { ...command, name: "other", aliases: ["other"] }
        ]) {
            expect(() => cli.addCommand(collision)).toThrow(/already registered/);
        }
        expect(cli.getAvailableCommands().filter(c => c.name === "other")).toHaveLength(0);
    });

    it.each(["Reload", "/reload", "", "reload config"])("rejects invalid name or alias %j", name => {
        const cli = new VimcordCLI();
        const command = { name, description: "Reloads config.", execute() {} };
        expect(() => cli.addCommand(command)).toThrow(/Invalid CLI command/);
        expect(() => cli.addCommand({ ...command, name: "valid", aliases: [name] })).toThrow(/Invalid CLI command/);
    });
});
