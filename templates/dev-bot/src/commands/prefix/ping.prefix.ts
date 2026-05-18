import { PrefixCommandModule } from "vimcord/dist/index.js";

export default new PrefixCommandModule({
    name: "ping",
    aliases: ["p"],
    description: "Checks prefix command dispatch.",
    metadata: {
        category: ["Testing"],
        tags: ["prefix", "hooks"]
    },

    hooks: {
        postExecute(ctx) {
            ctx.client.logger.debugVerbose(`[DevBot] Prefix command '${ctx.module.name}' completed`);
            return Promise.resolve();
        }
    },

    async execute({ client, message }) {
        const latency = client.ws.ping;

        await message.reply({ content: `Pong. WebSocket latency: ${latency}ms.` });
    }
});
