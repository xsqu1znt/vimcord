import EventEmitter from "node:events";
import { describe, expect, it, vi } from "vitest";
import { dynaSend } from "./dynaSend.js";
import { promptMessage } from "./prompt.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

function createFakeMessage() {
    const collector = Object.assign(new EventEmitter(), { stop: vi.fn() });
    const message: any = {
        editable: true,
        deletable: true,
        components: [],
        edit: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: () => collector
    };
    return { message, collector };
}

describe("promptMessage", () => {
    it("forces withResponse so a fresh interaction reply's collector actually starts", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, { timeout: 1000 });
        await new Promise(resolve => setImmediate(resolve));

        expect(dynaSend).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withResponse: true }));

        collector.emit("end", [], "time");
        const result = await resultPromise;
        expect(result.status).toBe("timeout");
    });

    it("resolves confirmed and rejected status from the matching button click", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, { timeout: 1000 });
        await new Promise(resolve => setImmediate(resolve));

        collector.emit("collect", {
            user: { id: "u1" },
            customId: "prompt:confirm",
            reply: vi.fn(),
            deferUpdate: vi.fn().mockResolvedValue(undefined)
        });
        await new Promise(resolve => setImmediate(resolve));
        collector.emit("end", [], "confirmed");

        const result = await resultPromise;
        expect(result.status).toBe("confirmed");
    });

    it("settles the prompt even when the collector ends synchronously inside onCollector", async () => {
        const { message, collector } = createFakeMessage();
        vi.mocked(dynaSend).mockResolvedValue(message);

        const resultPromise = promptMessage({} as any, {
            timeout: 1000,
            onCollector: () => {
                // "end" fires before onCollector itself returns; the completion listener must
                // already be registered or the prompt would hang forever waiting on it.
                collector.emit("end", [], "stopped-during-oncollector");
            }
        });

        const result = await resultPromise;
        expect(result.status).toBe("timeout");
    });
});
