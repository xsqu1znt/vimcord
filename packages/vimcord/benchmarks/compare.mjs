import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import { manualRouting, mountedRouting } from "./routing.mjs";

const OPTIONS = { targetSpeedup: 3, repetitions: 3, baselineCommit: "c40fe1ff023388db82b5dc5063db27a32d1cd705" };
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error("Usage: node benchmarks/compare.mjs /absolute/path/to/baseline/index.mjs");
const currentPath = new URL("../dist/index.js", import.meta.url);
const directory = await mkdtemp(`${tmpdir()}/vimcord-bench-`);
const runs = { baseline: [], current: [] };
const exec = promisify(execFile);

function median(values) {
    return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function authoring(fn) {
    const body = fn.toString().split("\n").slice(1, -1).join("\n");
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body);
    let tokens = 0;
    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens++;
    return { tokens, lines: body.split("\n").filter(line => line.trim()).length };
}

try {
    // Alternate order to limit thermal and run-order bias. Each library gets a fresh process.
    for (let repetition = 0; repetition < OPTIONS.repetitions; repetition++) {
        const order = repetition % 2 ? ["current", "baseline"] : ["baseline", "current"];
        for (const version of order) {
            const output = `${directory}/${version}-${repetition}.json`;
            await exec(process.execPath, [new URL("./run.mjs", import.meta.url).pathname, output], {
                env: {
                    ...process.env,
                    VIMCORD_BENCH_LIBRARY: version === "baseline" ? resolve(baselinePath) : currentPath.pathname
                }
            });
            runs[version].push(JSON.parse(await readFile(output, "utf8")));
            console.log(`Finished ${version}, repetition ${repetition + 1}/${OPTIONS.repetitions}`);
        }
    }
    const summary = runs.baseline[0].results.map((row, index) => {
        const baselineNs = median(runs.baseline.map(run => run.results[index].medianNs));
        const currentNs = median(runs.current.map(run => run.results[index].medianNs));
        const before = runs.baseline[0].results[index];
        const after = runs.current[0].results[index];
        if (before.sendsPerCommand !== after.sendsPerCommand || before.deferralsPerCommand !== after.deferralsPerCommand) {
            throw new Error(`Transport count changed for ${row.app}`);
        }
        return {
            app: row.app,
            logging: row.logging,
            baselineNs,
            currentNs,
            speedup: baselineNs / currentNs,
            baselinePromises: before.promisesPerCommand,
            currentPromises: after.promisesPerCommand,
            sendsPerCommand: after.sendsPerCommand,
            deferralsPerCommand: after.deferralsPerCommand
        };
    });
    const routingBefore = authoring(manualRouting);
    const routingAfter = authoring(mountedRouting);
    const report = {
        baselineCommit: OPTIONS.baselineCommit,
        baselineSha256: createHash("sha256")
            .update(await readFile(baselinePath))
            .digest("hex"),
        currentSha256: createHash("sha256")
            .update(await readFile(currentPath))
            .digest("hex"),
        summary,
        minimumSpeedup: Math.min(...summary.map(row => row.speedup)),
        minimumPromiseReduction: Math.min(...summary.map(row => row.baselinePromises / row.currentPromises)),
        targetSpeedup: OPTIONS.targetSpeedup,
        passedEveryScenario: summary.every(row => row.speedup >= OPTIONS.targetSpeedup),
        equalWorkloadSpeedup:
            summary.reduce((sum, row) => sum + row.baselineNs, 0) / summary.reduce((sum, row) => sum + row.currentNs, 0),
        geometricMeanSpeedup: Math.exp(summary.reduce((sum, row) => sum + Math.log(row.speedup), 0) / summary.length),
        routingAuthoring: {
            before: routingBefore,
            after: routingAfter,
            tokenReduction: routingBefore.tokens / routingAfter.tokens
        },
        runs
    };
    await writeFile(new URL("./results.json", import.meta.url), JSON.stringify(report, null, 4) + "\n");
    console.table(summary);
    console.log(
        JSON.stringify(
            {
                minimumSpeedup: report.minimumSpeedup,
                minimumPromiseReduction: report.minimumPromiseReduction,
                passedEveryScenario: report.passedEveryScenario,
                equalWorkloadSpeedup: report.equalWorkloadSpeedup,
                geometricMeanSpeedup: report.geometricMeanSpeedup,
                routingAuthoring: report.routingAuthoring
            },
            null,
            2
        )
    );
    if (!report.passedEveryScenario) process.exitCode = 1;
} finally {
    await rm(directory, { recursive: true, force: true });
}
