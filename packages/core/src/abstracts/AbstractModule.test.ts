import type { ModuleContext, ModuleHookContext } from "./AbstractModule.js";

import { describe, expect, it, vi } from "vitest";
import { AbstractModule } from "./AbstractModule.js";

class TestModule extends AbstractModule<[id: string]> {
    override moduleType = "Test";

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(): ModuleContext {
        return { client: this.client as any };
    }

    protected override createHookCTX(moduleCTX: ModuleContext, args: [string]): ModuleHookContext<[string]> {
        return { ...moduleCTX, module: this as any, args };
    }
}

function createClient() {
    return {
        isReady: () => true,
        logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), options: { verbose: false } }
    } as any;
}

describe("AbstractModule singleInvocation", () => {
    it("skips a matching invocation that's already running, without counting it as executed", async () => {
        let release!: () => void;
        const running = new Promise<void>(resolve => {
            release = resolve;
        });
        const execute = vi.fn(async () => running);
        const onAlreadyRunning = vi.fn();

        const module = new TestModule({
            name: "test",
            execute,
            singleInvocation: { key: ctx => `key:${ctx.args[0]}` },
            hooks: { onAlreadyRunning }
        });
        module.inject(createClient());

        const first = module.runWithResult("a");
        const second = await module.runWithResult("a");

        expect(second.executed).toBe(false);
        expect(onAlreadyRunning).toHaveBeenCalledTimes(1);

        release();
        await expect(first).resolves.toMatchObject({ executed: true });
    });

    it("releases the key after the handler throws, so a later invocation isn't blocked", async () => {
        const execute = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

        const module = new TestModule({
            name: "test",
            execute,
            singleInvocation: { key: () => "shared" }
        });
        module.inject(createClient());

        const first = await module.runWithResult("a");
        expect(first.executed).toBe(true);
        expect(first.error).toBeInstanceOf(Error);

        const second = await module.runWithResult("a");
        expect(second).toMatchObject({ executed: true, response: "ok" });
    });
});
