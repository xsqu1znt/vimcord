import { createHook } from "node:async_hooks";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { pathToFileURL } from "node:url";
import ansis from "ansis";
import { apps } from "./apps.mjs";

const OPTIONS = { warmup: 5_000, iterations: 20_000, samples: 9, promiseSamples: 100 };
const library = await import(
    process.env.VIMCORD_BENCH_LIBRARY ? pathToFileURL(process.env.VIMCORD_BENCH_LIBRARY).href : "../dist/index.js"
);
const loggingSink = process.env.VIMCORD_BENCH_LOG_SINK === "write" ? "write" : "record";
const results = [];

for (const logging of [false, ["execute"]]) {
    for (const app of apps) {
        const client = new library.Vimcord({ client: { intents: [] }, globals: { app: { commandLogging: logging } } });
        // These benchmarks start at a ready client; no gateway, REST, or database is contacted.
        client.isReady = () => true;
        let logs = 0;
        if (loggingSink === "write")
            client.logger.write = () => {
                logs++;
            };
        else
            client.logger.commandUsed = () => {
                logs++;
            };
        const bot = app.setup(client, library);
        try {
            for (let i = 0; i < OPTIONS.warmup; i++) await bot.run();
            bot.verify();
            const elapsed = [];
            for (let sample = 0; sample < OPTIONS.samples; sample++) {
                const startedAt = performance.now();
                for (let i = 0; i < OPTIONS.iterations; i++) await bot.run();
                elapsed.push(((performance.now() - startedAt) * 1e6) / OPTIONS.iterations);
            }
            let promises = 0;
            const hook = createHook({
                init(_id, type) {
                    if (type === "PROMISE") promises++;
                }
            });
            hook.enable();
            for (let i = 0; i < OPTIONS.promiseSamples; i++) await bot.run();
            hook.disable();
            bot.verify();
            elapsed.sort((a, b) => a - b);
            const result = {
                app: app.name,
                logging: logging !== false,
                medianNs: Math.round(elapsed[Math.floor(elapsed.length / 2)]),
                minNs: Math.round(elapsed[0]),
                maxNs: Math.round(elapsed.at(-1)),
                promisesPerCommand: promises / OPTIONS.promiseSamples,
                logsPerCommand: logs / (OPTIONS.warmup + OPTIONS.iterations * OPTIONS.samples + OPTIONS.promiseSamples),
                sendsPerCommand:
                    bot.io.state.sends / (OPTIONS.warmup + OPTIONS.iterations * OPTIONS.samples + OPTIONS.promiseSamples),
                deferralsPerCommand:
                    bot.io.state.deferrals / (OPTIONS.warmup + OPTIONS.iterations * OPTIONS.samples + OPTIONS.promiseSamples)
            };
            results.push(result);
            console.log(JSON.stringify(result));
        } finally {
            await client.destroy();
        }
    }
}

if (process.argv[2])
    await writeFile(
        process.argv[2],
        JSON.stringify(
            { node: process.version, cpu: cpus()[0].model, ansiLevel: ansis.level, loggingSink, options: OPTIONS, results },
            null,
            2
        ) + "\n"
    );
