import { EventModule } from "@vimcord/core";

export default new EventModule({
    event: "guildCreate",
    name: "Guild:Joined",
    metadata: {
        category: ["Lifecycle"],
        tags: ["guild"]
    },

    async execute(client, guild) {
        client.logger.info(`[DevBot] Joined guild '${guild.name}' (${guild.id})`);
    }
});
