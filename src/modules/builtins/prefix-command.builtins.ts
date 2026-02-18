import { EventBuilder } from "@/builders/event.builder";
import { userMention } from "discord.js";

export const prefixCommandHandler = new EventBuilder({
    event: "messageCreate",
    name: "PrefixCommandHandler",
    async execute(client, message) {
        if (message.author.bot || !message.guild) return;

        const config = client.config.prefixCommands;

        let activePrefix = config.defaultPrefix;

        if (config.guildPrefixResolver) {
            try {
                const customPrefix = await config.guildPrefixResolver(client, message.guild.id);
                if (customPrefix) activePrefix = customPrefix;
            } catch (err) {
                client.logger.error(`Error in guildPrefixResolver for guild ${message.guild.id}:`, err as Error);
            }
        }

        let prefixUsed: string | undefined;

        if (message.content.startsWith(activePrefix)) {
            prefixUsed = activePrefix;
        } else if (config.allowMentionAsPrefix) {
            const mention = userMention(client.user.id);
            if (message.content.startsWith(mention)) {
                prefixUsed = message.content.startsWith(`${mention} `) ? `${mention} ` : mention;
            }
        }

        if (!prefixUsed) return;

        const contentWithoutPrefix = message.content.slice(prefixUsed.length).trim();
        const args = contentWithoutPrefix.split(/\s+/);
        const trigger = args.shift();

        if (!trigger) return;

        const command = client.commands.prefix.get(trigger);
        if (!command) return;

        message.content = args.join(" ");

        try {
            return await command.run(client, client, message);
        } catch (err) {
            await client.error.handleCommandError(err as Error, message.guild, message);
        }
    }
});
