import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

async function main() {
    // --- Initialize the Client ---
    const client = new Vimcord({
        client: {
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
        },
        verbose: process.argv.includes("--verbose")
    });

    // --- Plugins ---
    client.use(new DotEnvPlugin());

    // --- Modules ---
    client.modules.load({
        slashCommands: { dir: "./commands/slash", suffix: ".slash" },
        prefixCommands: { dir: "./commands/prefix", suffix: ".prefix" },
        messageContextCommands: { dir: "./commands/context", suffix: ".mctx" },
        userContextCommands: { dir: "./commands/context", suffix: ".uctx" },
        events: { dir: "./events", suffix: ".event" }
    });

    // --- Start the Instance ---
    await client.login();
    // await client.modules.commands.pushByGuild();
    // await client.modules.commands.pullByGuild();
}

main();

// TODO: Add global error handlers here
