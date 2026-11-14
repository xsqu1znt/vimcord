import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProcessDir, isTSOrJS } from "@/utils/import.js";
import { Vimcord } from "../Vimcord.js";

const SRC = path.resolve(__dirname, "../..");
const PREFIX_MODULE = `
import { PrefixCommandModule } from "${SRC}/modules/index.js";
export default new PrefixCommandModule({ name: "ping", execute() {} });
`;
const EVENT_MODULE = `
import { EventModule } from "${SRC}/modules/index.js";
export default new EventModule({ event: "messageCreate", name: "ping", execute() {} });
`;

let root: string;
let client: Vimcord;

/** Writes fixture files and returns the directory relative to the entry file, the way `dir` is configured. */
function fixture(name: string, files: Record<string, string>): string {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, source] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), source);
    }
    return path.relative(getProcessDir(), dir);
}

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "vimcord-modules-"));
    client = new Vimcord({ intents: [], banner: false });
});

afterEach(async () => {
    await client.destroy();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("ModuleManager.load", () => {
    it("imports matching files, recursing into folders, and skips non-matching files silently", async () => {
        const dir = fixture("ok", {
            "nested/ping.prefix.ts": PREFIX_MODULE,
            "helper.ts": `throw new Error("a helper must not be imported");`
        });
        await client.modules.load({ prefixCommands: { dir, suffix: ".prefix" } });
        expect(client.modules.commands.prefix.getByName("ping")).toBeDefined();
    });

    it("names a directory that does not exist", async () => {
        await expect(client.modules.load({ events: { dir: "./missing", suffix: null } })).rejects.toThrow(
            /'.\/missing' does not exist/
        );
    });

    it("names a directory with no matching modules, checking each directory in a list", async () => {
        const good = fixture("good", { "ping.prefix.ts": PREFIX_MODULE });
        const empty = fixture("empty", { "helper.ts": "export {};" });
        await expect(client.modules.load({ prefixCommands: { dir: [good, empty], suffix: ".prefix" } })).rejects.toThrow(
            new RegExp(`'${empty}' has no modules`)
        );
    });

    it("names every file that fails to import and keeps the cause", async () => {
        const dir = fixture("broken", {
            "a.prefix.ts": `throw new Error("boom a");`,
            "b.prefix.ts": `throw new Error("boom b");`
        });
        const error = (await client.modules.load({ prefixCommands: { dir, suffix: ".prefix" } }).catch(e => e)) as Error;
        expect(error.message).toMatch(/a\.prefix\.ts.*boom a/);
        expect(error.message).toMatch(/b\.prefix\.ts.*boom b/);
        expect(error.cause).toBeInstanceOf(Error);
    });

    it("rejects a helper file picked up by suffix: null", async () => {
        const dir = fixture("helper", { "ping.prefix.ts": PREFIX_MODULE, "helper.ts": "export const value = 1;" });
        await expect(client.modules.load({ prefixCommands: { dir, suffix: null } })).rejects.toThrow(
            /helper\.ts' has no default export; modules\.prefixCommands expects a PrefixCommandModule/
        );
    });

    it("rejects a default export that isn't a module", async () => {
        const dir = fixture("plain", { "ping.prefix.ts": "export default { name: 'ping' };" });
        await expect(client.modules.load({ prefixCommands: { dir, suffix: ".prefix" } })).rejects.toThrow(
            /ping\.prefix\.ts' has a default export of type 'Object'/
        );
    });

    it("rejects a module of the wrong type for its key", async () => {
        const dir = fixture("wrong", { "ping.event.ts": EVENT_MODULE });
        await expect(client.modules.load({ prefixCommands: { dir, suffix: null } })).rejects.toThrow(
            /ping\.event\.ts' has a default export of type 'EventModule'; modules\.prefixCommands expects/
        );
    });

    it("loads each conventional suffix from one directory string, letting a type have no files", async () => {
        const dir = fixture("shorthand", {
            "commands/ping.prefix.ts": PREFIX_MODULE,
            "events/ping.event.ts": EVENT_MODULE,
            "helper.ts": `throw new Error("a helper must not be imported");`
        });
        await client.modules.load(dir);
        expect(client.modules.commands.prefix.getByName("ping")).toBeDefined();
        expect(client.modules.events.getByEvent("messageCreate")).toHaveLength(1);
        expect(client.modules.commands.slash.getAll()).toEqual([]);
    });

    it("names an unnamed event module after its event, and loads two of them on one event", async () => {
        const unnamed = `
import { EventModule } from "${SRC}/modules/index.js";
export default new EventModule({ event: "messageCreate", execute() {} });
`;
        const dir = fixture("unnamed", { "a.event.ts": unnamed, "b.event.ts": unnamed });
        await client.modules.load({ events: { dir, suffix: ".event" } });
        const events = client.modules.events.getByEvent("messageCreate");
        expect(events.map(e => e.name)).toEqual(["messageCreate", "messageCreate"]);
    });

    it("still rejects a missing directory or a wrong module type under the shorthand", async () => {
        await expect(client.modules.load("./missing")).rejects.toThrow(/'.\/missing' does not exist/);
        const dir = fixture("mislabeled", { "ping.slash.ts": PREFIX_MODULE });
        await expect(client.modules.load(dir)).rejects.toThrow(/modules\.slashCommands expects a SlashCommandModule/);
    });

    it("fails login with the file named and leaves nothing loaded for a retry", async () => {
        await client.destroy();
        const good = fixture("good", { "ping.prefix.ts": PREFIX_MODULE });
        const bad = fixture("bad", { "x.event.ts": "export default 1;" });
        client = new Vimcord({
            intents: [],
            banner: false,
            modules: { prefixCommands: { dir: good, suffix: ".prefix" }, events: { dir: bad, suffix: ".event" } }
        });
        await expect(client.login("token")).rejects.toThrow(/x\.event\.ts/);
        expect(client.modules.commands.prefix.getAll()).toEqual([]);
    });
});

describe("isTSOrJS", () => {
    it("never treats declaration files as modules", () => {
        expect(isTSOrJS("ping.d.ts", null)).toBe(false);
        expect(isTSOrJS("ping.ts", null)).toBe(true);
        expect(isTSOrJS("ping.js", [".slash", ""])).toBe(true);
        expect(isTSOrJS("ping.ts", [".slash"])).toBe(false);
    });
});
