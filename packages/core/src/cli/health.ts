import type { Vimcord } from "@/client/Vimcord.js";
import type { HealthProbeResult, RegisteredHealthProbe } from "./types.js";

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

export interface CompletedHealthProbe extends RegisteredHealthProbe {
    /** Isolated result returned by the provider or synthesized after failure. */
    result: HealthProbeResult;
}

/** Runs one plugin probe with independent timeout, cancellation, and error isolation. */
async function runHealthProbe(
    client: Vimcord,
    registration: RegisteredHealthProbe,
    parentSignal: AbortSignal
): Promise<CompletedHealthProbe> {
    const { probe } = registration;
    const controller = new AbortController();
    let resolveInterruption: (result: HealthProbeResult) => void = () => undefined;
    const interruption = new Promise<HealthProbeResult>(resolve => {
        resolveInterruption = resolve;
    });
    const abort = (): void => {
        controller.abort(parentSignal.reason);
        resolveInterruption({ status: "unavailable", detail: "Cancelled" });
    };
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });

    const timeoutMs = Math.max(1, probe.timeout ?? DEFAULT_HEALTH_TIMEOUT_MS);
    const timeoutRef = setTimeout(() => {
        controller.abort(new Error(`Health check exceeded ${timeoutMs}ms`));
        resolveInterruption({ status: "unavailable", detail: "Timed out" });
    }, timeoutMs);
    timeoutRef.unref?.();

    try {
        const check = controller.signal.aborted
            ? interruption
            : Promise.resolve(probe.check({ client, signal: controller.signal }));
        const result = await Promise.race([check, interruption]);
        return { ...registration, result };
    } catch (error) {
        return {
            ...registration,
            result: {
                status: "unavailable",
                detail: error instanceof Error ? error.message : String(error)
            }
        };
    } finally {
        clearTimeout(timeoutRef);
        parentSignal.removeEventListener("abort", abort);
    }
}

/** Collects all installed service probes without letting one provider fail the full command. */
export async function collectClientHealth(client: Vimcord, signal: AbortSignal): Promise<CompletedHealthProbe[]> {
    return await Promise.all(client.plugins.getHealthProbes().map(probe => runHealthProbe(client, probe, signal)));
}
