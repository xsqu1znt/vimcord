import type { ModuleConditionFn, ModuleTestResult } from "./AbstractModule.js";

/** Tests conditions in order, entering an async continuation only for a condition that actually waits. */
export function testConditions<CTX>(
    conditions: readonly ModuleConditionFn<CTX>[],
    ctx: CTX,
    label = "Condition"
): ModuleTestResult | Promise<ModuleTestResult> {
    function from(start: number): ModuleTestResult | Promise<ModuleTestResult> {
        for (let i = start; i < conditions.length; i++) {
            const failed = (error: unknown): ModuleTestResult => ({
                passed: false,
                reason: `${label} threw an error at index ${i}`,
                error: error as Error
            });
            try {
                const result = conditions[i]!(ctx);
                if (result instanceof Promise) return result.then(result => (result.passed ? from(i + 1) : result), failed);
                if (!result.passed) return result;
            } catch (error) {
                return failed(error);
            }
        }
        return { passed: true };
    }
    return from(0);
}
