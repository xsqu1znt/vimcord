import { PrefixCommandModule } from "@vimcord/core";
import { dynaSend } from "@vimcord/ux";

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

    async execute(client, message) {
        const latency = client.ws.ping;

        await dynaSend(message, {
            content: `Pong. WebSocket latency: ${latency}ms.`
        });
    }
});
