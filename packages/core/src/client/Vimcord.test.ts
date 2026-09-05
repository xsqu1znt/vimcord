import { afterEach, describe, expect, it } from "vitest";
import { Vimcord } from "./Vimcord.js";

afterEach(async () => {
    await Vimcord.getInstance()?.destroy();
});

describe("Vimcord client lifecycle", () => {
    it("rejects a second live client", () => {
        new Vimcord({ client: { intents: [] } });

        expect(() => new Vimcord({ client: { intents: [] } })).toThrow("Only one Vimcord client can exist in a process");
    });

    it("permits a replacement after successful destruction", async () => {
        const first = new Vimcord({ client: { intents: [] } });
        await first.destroy();

        const replacement = new Vimcord({ client: { intents: [] } });
        expect(Vimcord.getInstance()).toBe(replacement);
    });

    it("does not unregister a replacement when an old client is destroyed again", async () => {
        const first = new Vimcord({ client: { intents: [] } });
        await first.destroy();
        const replacement = new Vimcord({ client: { intents: [] } });

        await first.destroy();

        expect(Vimcord.getInstance()).toBe(replacement);
    });
});
