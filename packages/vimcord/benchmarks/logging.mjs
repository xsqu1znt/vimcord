import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const OPTIONS = { repetitions: 3, baselineCommit: "e3492839159a5b4e6ecc75464e553b4ccb37b7d8" };
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error("Usage: node benchmarks/logging.mjs /absolute/path/to/logging-baseline/index.mjs");
const currentPath = new URL("../dist/index.js", import.meta.url);
const directory = await mkdtemp(`${tmpdir()}/vimcord-logging-`);
const exec = promisify(execFile);
const runs = { record: { baseline: [], current: [] }, write: { baseline: [], current: [] } };

function median(values) {
    return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

try {
    for (const sink of ["record", "write"]) {
        for (let repetition = 0; repetition < OPTIONS.repetitions; repetition++) {
            const order = repetition % 2 ? ["current", "baseline"] : ["baseline", "current"];
            for (const version of order) {
                const output = `${directory}/${sink}-${version}-${repetition}.json`;
                await exec(process.execPath, [new URL("./run.mjs", import.meta.url).pathname, output], {
                    env: {
                        ...process.env,
                        VIMCORD_BENCH_LOG_SINK: sink,
                        VIMCORD_BENCH_LIBRARY: version === "baseline" ? resolve(baselinePath) : currentPath.pathname
                    }
                });
                const run = JSON.parse(await readFile(output, "utf8"));
                for (const row of run.results) {
                    if (row.logsPerCommand !== Number(row.logging)) throw new Error(`Wrong usage-log count: ${row.app}`);
                    if (row.sendsPerCommand !== 1 || row.deferralsPerCommand !== Number(row.app === "support"))
                        throw new Error(`Transport changed: ${row.app}`);
                }
                runs[sink][version].push(run);
                console.log(`${sink}: ${version} ${repetition + 1}/${OPTIONS.repetitions}`);
            }
        }
    }
    const summary = [];
    for (const sink of ["record", "write"]) {
        const suite = runs[sink];
        for (const app of ["utility", "economy", "moderation", "support", "bookmarks"]) {
            const timings = {};
            for (const version of ["baseline", "current"]) {
                for (const logging of [false, true]) {
                    timings[`${version}${logging ? "On" : "Off"}Ns`] = median(
                        suite[version].map(
                            run => run.results.find(row => row.app === app && row.logging === logging).medianNs
                        )
                    );
                }
            }
            const baselineOverheadNs = timings.baselineOnNs - timings.baselineOffNs;
            const currentOverheadNs = timings.currentOnNs - timings.currentOffNs;
            summary.push({
                sink,
                app,
                ...timings,
                baselineOverheadNs,
                currentOverheadNs,
                overheadReduction: 1 - currentOverheadNs / baselineOverheadNs,
                loggingOnSpeedup: timings.baselineOnNs / timings.currentOnNs
            });
        }
    }
    const report = {
        baselineCommit: OPTIONS.baselineCommit,
        baselineSha256: createHash("sha256")
            .update(await readFile(baselinePath))
            .digest("hex"),
        currentSha256: createHash("sha256")
            .update(await readFile(currentPath))
            .digest("hex"),
        summary,
        runs
    };
    await writeFile(new URL("./logging-results.json", import.meta.url), JSON.stringify(report, null, 4) + "\n");
    console.table(summary);
} finally {
    await rm(directory, { recursive: true, force: true });
}
