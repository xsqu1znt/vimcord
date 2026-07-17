import type { ModuleContext, ModuleHookContext } from "./AbstractModule.js";

import { describe, expect, it, vi } from "vitest";
import { AbstractModule } from "./AbstractModule.js";

class TestModule extends AbstractModule<[], ModuleContext, ModuleHookContext<[]>> {
    override readonly moduleType = "Test";

    protected override async checkInjection(): Promise<boolean> {
        return true;
    }

    protected override async performTests(): Promise<boolean> {
        return true;
    }

    protected override validate(): boolean {
        return true;
    }

    protected override createModuleCTX(): ModuleContext {
        return { client: {} as ModuleContext["client"] };
    }

    protected override createHookCTX(): ModuleHookContext<[]> {
        return {
            args: [],
            client: {} as ModuleContext["client"],
            module: this
        };
    }
}

describe("AbstractModule.runWithResult", () => {
    it("reports preExecute halts without running the module", async () => {
        const execute = vi.fn();
        const module = new TestModule({
            name: "halted",
            execute,
            hooks: {
                preExecute: vi.fn(async () => undefined)
            }
        });

        await expect(module.runWithResult()).resolves.toEqual({ executed: false, response: undefined });
        expect(execute).not.toHaveBeenCalled();
    });

    it("reports execution after preExecute continues", async () => {
        const execute = vi.fn(() => "done");
        const module = new TestModule({
            name: "continued",
            execute,
            hooks: {
                preExecute: vi.fn(async (_ctx, next) => next())
            }
        });

        await expect(module.runWithResult()).resolves.toEqual({ executed: true, response: "done" });
        expect(execute).toHaveBeenCalledOnce();
    });
});
