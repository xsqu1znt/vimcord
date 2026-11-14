import { GatewayIntentBits } from "discord.js";
import { Vimcord } from "vimcord";
import { DotEnvPlugin } from "@vimcord/plugin-dotenv";

const client = new Vimcord({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    plugins: [new DotEnvPlugin()],
    prefix: "!",
    modules: "./",
    ux: { embedColor: "Blurple" }
});

await client.login();
