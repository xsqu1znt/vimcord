import type { ModuleContext, ModuleHookContext } from "./AbstractModule.js";

import { describe, expect, it, vi } from "vitest";
import { EventModule } from "@/modules/EventModule.js";
import { AbstractModule } from "./AbstractModule.js";

type TestContext = ModuleContext & { id: string };
type TestHookContext = TestContext & ModuleHookContext<[id: string]>;

class TestModule extends AbstractModule<[id: string], TestContext, TestHookContext> {
    override moduleType = "Test";

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX([id]: [string]): TestContext {
        return { client: this.client as any, id };
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
        const onBlocked = vi.fn();

        const module = new TestModule({
            name: "test",
            execute,
            singleInvocation: { key: ctx => `key:${ctx.id}` },
            hooks: { onBlocked }
        });
        module.inject(createClient());

        const first = module.runWithResult("a");
        const second = await module.runWithResult("a");

        expect(second.executed).toBe(false);
        expect(onBlocked).toHaveBeenCalledExactlyOnceWith(expect.anything(), { kind: "running" });

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

describe("AbstractModule stages", () => {
    it("keeps event invocations unmeasured", async () => {
        const execute = vi.fn();
        const module = new EventModule({ name: "ready", event: "clientReady", execute });
        module.inject(createClient());
        const clock = vi.spyOn(performance, "now");
        try {
            await module.run();
            const result = await module.runWithResult();
            expect(execute).toHaveBeenCalledTimes(2);
            expect(result.executionTiming).toBeUndefined();
            expect(clock).not.toHaveBeenCalled();
        } finally {
            clock.mockRestore();
        }
    });

    it("runs overridden async tests and readiness checks even with empty base configuration", async () => {
        const calls: string[] = [];
        class CustomizedModule extends TestModule {
            protected override async checkInjection(): Promise<boolean> {
                calls.push("injection");
                return super.checkInjection();
            }
            protected override testEnvironment(ctx: TestHookContext) {
                calls.push("environment");
                return super.testEnvironment(ctx);
            }
            protected override performTests(ctx: TestHookContext) {
                calls.push("tests");
                return Promise.resolve(super.performTests(ctx)).then(result => result);
            }
        }
        const module = new CustomizedModule({
            name: "custom",
            execute: () => {
                calls.push("execute");
            }
        });
        module.inject(createClient());
        expect(await module.runWithResult("a")).toMatchObject({ executed: true });
        expect(calls).toEqual(["injection", "tests", "environment", "execute"]);
    });

    it("observes hooks added between invocations and runs before, then execute", async () => {
        const calls: string[] = [];
        const module = new TestModule({ name: "mutable", execute: () => calls.push("execute") });
        module.inject(createClient());
        await module.run("a");
        module.hooks.before = () => {
            calls.push("before");
            return true;
        };
        await module.run("a");
        expect(calls).toEqual(["execute", "before", "execute"]);
    });

    it.each([
        ["false", () => false],
        ["undefined", () => undefined as unknown as boolean],
        ["async false", async () => false]
    ])("stops on a before that returns %s", async (_name, before) => {
        const execute = vi.fn();
        const module = new TestModule({ name: "gate", execute, hooks: { before } });
        module.inject(createClient());
        expect(await module.runWithResult("a")).toMatchObject({ executed: false });
        expect(execute).not.toHaveBeenCalled();
    });

    it("treats a before that throws as blocked and reports it to onError", async () => {
        const execute = vi.fn();
        const onError = vi.fn();
        const module = new TestModule({
            name: "gate",
            execute,
            hooks: {
                before: () => {
                    throw new Error("gate failed");
                },
                onError
            }
        });
        module.inject(createClient());
        expect(await module.runWithResult("a")).toMatchObject({ executed: false });
        expect(execute).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
    });

    it("blocks outside its environment, sending the block to onBlocked or else to onError", async () => {
        const execute = vi.fn();
        const client = { ...createClient(), $devMode: true };
        const onBlocked = vi.fn();
        const observed = new TestModule({ name: "env", environment: "production", execute, hooks: { onBlocked } });
        observed.inject(client);
        await observed.run("a");
        expect(onBlocked).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
            kind: "environment",
            reason: "Client is in development mode"
        });

        const onError = vi.fn();
        const fallback = new TestModule({ name: "env", environment: "production", execute, hooks: { onError } });
        fallback.inject(client);
        await fallback.run("a");
        expect(onError).toHaveBeenCalledOnce();
        expect(execute).not.toHaveBeenCalled();
    });

    it("waits for readiness and suppresses disabled diagnostic formatting", async () => {
        let release!: (ready: boolean) => void;
        const ready = new Promise<boolean>(r => (release = r));
        const execute = vi.fn();
        const module = new TestModule({ name: "ready", execute });
        const client = createClient();
        client.isReady = () => false;
        client.awaitReady = () => ready;
        module.inject(client);
        const name = vi.spyOn(module as unknown as { buildName(): string }, "buildName");
        const pending = module.run("a");
        expect(execute).not.toHaveBeenCalled();
        release(true);
        await pending;
        expect(execute).toHaveBeenCalledOnce();
        expect(name).not.toHaveBeenCalled();
    });
});
