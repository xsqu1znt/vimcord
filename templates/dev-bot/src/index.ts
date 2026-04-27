import { DotEnvPlugin } from "@vimcord/plugin-dotenv";
import { createBot } from "./bot.js";

async function main() {
    const bot = createBot();
    await bot.use(new DotEnvPlugin());

    await bot.login();
}

main();
