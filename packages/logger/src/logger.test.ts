import { Logger } from "./logger.js";

const logger = new Logger({
    prefix: "vimcord",
    prefixEmoji: "⚡",
    showTimestamp: true
});

// --- Helpers ---

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function wait(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
}

function randomItem<T>(arr: T[]): T {
    return arr[randomInt(0, arr.length - 1)]!;
}

// --- Sample Data ---

const debugMessages = [
    "Resolving module path: @vimcord/core",
    "Cache hit for card pool: kep1er-2024",
    "WebSocket heartbeat sent",
    "Debounce timer reset for user 182736450",
    "Guild prefix resolved: !"
];

const infoMessages = [
    "Bot connected to 12 guilds",
    "Slash commands registered globally",
    "Plugin 'mongoose' installed successfully",
    "Event handler loaded: messageCreate",
    "Dev mode enabled — using TOKEN_DEV"
];

const successMessages = [
    "Database connection established",
    "Card drop executed in 42ms",
    "Command handler initialized",
    "All modules loaded successfully",
    "Login successful"
];

const warnMessages = [
    "Rate limit approaching for guild 8827364501",
    "MongoDB query took 320ms — consider indexing",
    "Missing MONGO_URI_DEV, falling back to MONGO_URI",
    "Plugin 'redis' registered but not connected",
    "Unhandled promise rejection caught by global handler"
];

const errorMessages = [
    ["Failed to load event: interactionCreate", new Error("Cannot find module './events/interactionCreate.js'")],
    ["Command execution failed: /drop", new Error("Card pool is empty for this banner")],
    ["Database write failed", new Error("MongoServerError: E11000 duplicate key error")]
] as [string, Error][];

const loaderTasks = [
    ["Connecting to MongoDB...", "MongoDB connected"],
    ["Registering slash commands...", "Slash commands registered"],
    ["Loading card pool cache...", "Card pool ready — 2,400 cards loaded"],
    ["Syncing guild configurations...", "Guild configs synced"],
    ["Warming up image pipeline...", "Image pipeline ready"],
    ["Fetching idol metadata...", "Idol metadata loaded"]
];

// --- Test Runner ---

async function runLogTest(): Promise<void> {
    logger.info("Starting randomized log output...");
    await wait(300);

    // Kick off a few loaders concurrently
    const task1 = randomItem(loaderTasks)!;
    const task2 = randomItem(loaderTasks)!;
    const task3 = randomItem(loaderTasks)!;

    const stop1 = logger.loader(task1[0]!);
    await wait(randomInt(300, 600));
    const stop2 = logger.loader(task2[0]!);
    await wait(randomInt(300, 600));
    const stop3 = logger.loader(task3[0]!);

    // Fire random log messages while loaders are running
    const logInterval = setInterval(
        () => {
            const roll = randomInt(0, 3);
            if (roll === 0) logger.debug(randomItem(debugMessages));
            else if (roll === 1) logger.info(randomItem(infoMessages));
            else if (roll === 2) logger.warn(randomItem(warnMessages));
            else logger.success(randomItem(successMessages));
        },
        randomInt(400, 900)
    );

    // Resolve loaders at staggered intervals
    await wait(randomInt(1500, 2500));
    stop2(task2[1]);

    await wait(randomInt(800, 1500));
    stop1(task1[1]);

    await wait(randomInt(600, 1200));
    stop3(task3[1]);

    clearInterval(logInterval);
    await wait(300);

    // Fire a few more logs after loaders are gone
    logger.debug(randomItem(debugMessages));
    await wait(200);
    logger.info(randomItem(infoMessages));
    await wait(200);
    logger.success(randomItem(successMessages));
    await wait(200);
    logger.warn(randomItem(warnMessages));
    await wait(200);

    // Single loader with an error outcome
    const errTask = randomItem(loaderTasks)!;
    const stopErr = logger.loader(errTask[0]!);
    await wait(randomInt(1000, 2000));
    stopErr("✕ " + errTask[0]!.replace("...", " failed"));

    await wait(300);

    // Log an actual error with stack
    const [errMsg, errObj] = randomItem(errorMessages)!;
    logger.error(errMsg, errObj);
}

async function runBannerTest(): Promise<void> {
    /* await logger.banner({
        name: "My Amazing Bot",
        version: "1.0.0",
        poweredBy: "Powered by Vimcord v2.0.0",
        devMode: true,
        meta: [
            ["📦 Events", "2 ·"],
            ["📦 Slash Commands", "3 ·"],
            ["📦 Prefix Commands", "14 ·"],
            ["📦 Context Commands", "2 ·"],
            ["", ""],
            ["🔌 Plugin", "@vimcord/plugin-mongoose ·"],
            ["🔌 Plugin", "@vimcord/plugin-multi-instance ·"]
        ]
    });

    await runLogTest().catch(console.error); */
}

runBannerTest().catch(console.error);
