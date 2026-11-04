import { describe, expect, it, vi } from "vitest";
import { testConditions } from "./testConditions.js";

describe("condition sequencing", () => {
    it("keeps a synchronous chain synchronous and shares context updates", () => {
        const ctx = { checked: false };
        const result = testConditions(
            [
                c => {
                    c.checked = true;
                    return { passed: true };
                },
                c => (c.checked ? { passed: true } : { passed: false, reason: "Context update was lost" })
            ],
            ctx
        );
        expect(result).toEqual({ passed: true });
        expect(result).not.toBeInstanceOf(Promise);
    });

    it("waits for an asynchronous condition before running later checks", async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => {
            release = r;
        });
        const calls: number[] = [];
        const result = testConditions(
            [
                () => {
                    calls.push(1);
                    return { passed: true };
                },
                async () => {
                    await gate;
                    calls.push(2);
                    return { passed: true };
                },
                () => {
                    calls.push(3);
                    return { passed: true };
                }
            ],
            {}
        );
        expect(calls).toEqual([1]);
        release();
        expect(await result).toEqual({ passed: true });
        expect(calls).toEqual([1, 2, 3]);
    });

    it("stops on an asynchronous failure without running later checks", async () => {
        const next = vi.fn(() => ({ passed: true as const }));
        const denied = { passed: false as const, reason: "Denied" };
        expect(await testConditions([async () => denied, next], {})).toBe(denied);
        expect(next).not.toHaveBeenCalled();
    });

    it.each([false, true])("reports the right failed index for async=%s", async asynchronous => {
        const error = new Error("Unavailable");
        const fail = () => {
            throw error;
        };
        const result = testConditions(
            [() => ({ passed: true }), asynchronous ? async () => fail() : fail],
            {},
            "Route condition"
        );
        expect(await result).toEqual({ passed: false, reason: "Route condition threw an error at index 1", error });
    });
});
