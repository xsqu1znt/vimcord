import { Vimcord } from "vimcord";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MongoosePlugin } from "./index.js";

let client: Vimcord | undefined;

afterEach(async () => {
    await client?.destroy();
    client = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("initial MongoDB connection", () => {
    it("rejects login before the gateway after three retries", async () => {
        vi.useFakeTimers();
        const plugin = new MongoosePlugin({ uri: "mongodb://mock.invalid/test" });
        const connect = vi.spyOn(plugin.mongoose, "connect").mockRejectedValue(new Error("Connection refused"));
        const gateway = vi.spyOn(Object.getPrototypeOf(Vimcord.prototype), "login").mockResolvedValue("mock");
        client = new Vimcord({ intents: [], disableBanner: true, plugins: [plugin] });
        const result = expect(client.login("mock")).rejects.toThrow("MongoDB initial connection failed");
        await vi.advanceTimersByTimeAsync(5_000);
        await result;
        expect(connect).toHaveBeenCalledTimes(4);
        expect(gateway).not.toHaveBeenCalled();
        expect(client.plugins.isInstalled("mongoose")).toBe(false);
    });

    it("can connect on the last retry and leaves subsequent reconnects to Mongoose", async () => {
        vi.useFakeTimers();
        const uri = "mongodb://mock.invalid/test";
        const connectOptions = { dbName: "test", maxPoolSize: 5 };
        const plugin = new MongoosePlugin({ uri, connectOptions });
        plugin.mongoose.set("strictQuery", true);
        const connect = vi
            .spyOn(plugin.mongoose, "connect")
            .mockRejectedValueOnce(new Error("Connection refused"))
            .mockRejectedValueOnce(new Error("Connection refused"))
            .mockRejectedValueOnce(new Error("Connection refused"))
            .mockResolvedValue(plugin.mongoose);
        const gateway = vi.spyOn(Object.getPrototypeOf(Vimcord.prototype), "login").mockResolvedValue("mock");
        client = new Vimcord({ intents: [], disableBanner: true, plugins: [plugin] });
        const result = client.login("mock");
        await vi.advanceTimersByTimeAsync(5_000);
        await result;
        expect(connect).toHaveBeenCalledTimes(4);
        expect(connect).toHaveBeenLastCalledWith(uri, connectOptions);
        expect(gateway).toHaveBeenCalledOnce();
        expect(plugin.mongoose.get("strictQuery")).toBe(true);
        expect(plugin.client).toBe(client);
        const log = vi.spyOn(client.logger.plugin, "log");
        plugin.mongoose.connection.emit("disconnected");
        expect(log).toHaveBeenCalledWith("mongoose", "MongoDB disconnected");
        expect(connect).toHaveBeenCalledTimes(4);
    });
});
