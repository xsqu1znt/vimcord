import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import type { RemoteApplicationCommand } from "./applicationCommandData.js";

import { describe, expect, it } from "vitest";
import { createApplicationCommandUpdatePayload, hasApplicationCommandChanged } from "./applicationCommandData.js";

function createCommand(contexts?: number[]): RESTPostAPIApplicationCommandsJSONBody {
    return { name: "ping", description: "Ping", ...(contexts ? { contexts } : {}) };
}

function createRemoteCommand(contexts: number[]): RemoteApplicationCommand {
    return { id: "command", name: "ping", description: "Ping", contexts };
}

describe("application command comparison", () => {
    it("keeps global guild-only contexts distinct from the global default", () => {
        expect(hasApplicationCommandChanged(createCommand([0]), createRemoteCommand([0, 1, 2]), "global")).toBe(true);
    });

    it("treats context order and guild command contexts as immaterial", () => {
        expect(hasApplicationCommandChanged(createCommand([2, 0, 1]), createRemoteCommand([0, 1, 2]), "global")).toBe(false);
        expect(hasApplicationCommandChanged(createCommand([0]), createRemoteCommand([0, 1, 2]), "guild")).toBe(false);
    });

    it("sends the global default contexts when a patch restores omitted contexts", () => {
        expect(createApplicationCommandUpdatePayload(createCommand(), "global")).toMatchObject({ contexts: [0, 1, 2] });
        expect(createApplicationCommandUpdatePayload({ ...createCommand(), dm_permission: false }, "global")).toMatchObject({
            contexts: [0]
        });
    });
});
