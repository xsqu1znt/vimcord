import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { isDuplicateKeyError } from "./isDuplicateKeyError.js";

describe("isDuplicateKeyError", () => {
    it.each([
        new mongoose.mongo.MongoServerError({ code: 11000, keyPattern: { key: 1 } }),
        { code: 11000, keyPattern: { key: 1 } },
        { codeName: "DuplicateKey", keyPattern: { key: 1 } }
    ])("recognizes driver and plain duplicate-key errors: %j", error => {
        expect(isDuplicateKeyError(error)).toBe(true);
        expect(isDuplicateKeyError(error, "key")).toBe(true);
        expect(isDuplicateKeyError(error, "other")).toBe(false);
    });

    it("matches fields in compound indexes without matching inherited fields", () => {
        const error = { code: 11000, keyPattern: { guild: 1, key: 1 } };
        expect(isDuplicateKeyError(error, "guild")).toBe(true);
        expect(isDuplicateKeyError(error, "key")).toBe(true);
        expect(isDuplicateKeyError(error, "toString")).toBe(false);
    });

    it.each([undefined, null, 11000, "DuplicateKey", new Error("duplicate"), { code: 11001 }, { codeName: "Other" }])(
        "rejects unrelated errors: %j",
        error => {
            expect(isDuplicateKeyError(error)).toBe(false);
            expect(isDuplicateKeyError(error, "key")).toBe(false);
        }
    );

    it.each([undefined, null, "key", 1, {}])("requires a matching keyPattern for a path: %j", keyPattern => {
        expect(isDuplicateKeyError({ code: 11000, keyPattern })).toBe(true);
        expect(isDuplicateKeyError({ code: 11000, keyPattern }, "key")).toBe(false);
    });
});
