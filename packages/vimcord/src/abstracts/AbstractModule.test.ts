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

describe("AbstractModule stage compatibility", () => {
    it("runs overridden async tests and readiness checks even with empty base configuration", async () => {
        const calls: string[] = [];
        class CustomizedModule extends TestModule {
            protected override async checkInjection(): Promise<boolean> {
                calls.push("injection");
                return super.checkInjection();
            }
            protected override testDeployment(ctx: ModuleHookContext<[string]>) {
                calls.push("deployment");
                return super.testDeployment(ctx);
            }
            protected override testConditions(ctx: ModuleHookContext<[string]>) {
                calls.push("conditions");
                return super.testConditions(ctx).then(result => result);
            }
            protected override performTests(ctx: ModuleHookContext<[string]>) {
                calls.push("tests");
                return super.performTests(ctx).then(result => result);
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
        expect(calls).toEqual(["injection", "tests", "deployment", "conditions", "execute"]);
    });

    it("observes conditions and hooks added between invocations and preserves fail/pre/execute/post order", async () => {
        const calls: string[] = [];
        const module = new TestModule({ name: "mutable", execute: () => calls.push("execute") });
        module.inject(createClient());
        await module.run("a");
        module.conditions.push(() => {
            calls.push("condition");
            return { passed: true };
        });
        module.hooks.preExecute = async (_ctx, next) => {
            calls.push("pre");
            next();
        };
        module.hooks.postExecute = async () => {
            calls.push("post");
        };
        await module.run("a");
        module.conditions.push(() => ({ passed: false, reason: "blocked" }));
        module.hooks.onConditionTestFail = async () => {
            calls.push("fail");
        };
        const result = await module.runWithResult("a");
        expect(result.executed).toBe(false);
        expect(calls).toEqual(["execute", "condition", "pre", "execute", "post", "condition", "fail"]);
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
