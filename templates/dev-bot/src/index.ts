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
        slashCommands: "./commands/slash",
        prefixCommands: "./commands/prefix",
        contextCommands: "./commands/context",
        events: "./events"
    });

    // --- Start the Instance ---
    await client.login();
    // await client.modules.commands.registerGuild();
}

main();

// TODO: Add global error handlers here
