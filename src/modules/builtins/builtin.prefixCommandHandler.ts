import { EventBuilder } from "@/builders/event.builder";
import { sendCommandErrorEmbed } from "@/utils/sendCommandErrorEmbed";
import { userMention } from "discord.js";

export const BUILTIN_PrefixCommandHandler = new EventBuilder({
    event: "messageCreate",
    name: "PrefixCommandHandler",
    async execute(client, message) {
        if (message.author.bot || !message.guild) return;

        const config = client.config.prefixCommands;

        // 1. Resolve the active prefix for this guild
        let activePrefix = config.defaultPrefix;

        if (config.guildPrefixResolver) {
            try {
                const customPrefix = await config.guildPrefixResolver(client, message.guild.id);
                if (customPrefix) activePrefix = customPrefix;
            } catch (err) {
                client.logger.error(`Error in guildPrefixResolver for guild ${message.guild.id}:`, err as Error);
                // Fallback to defaultPrefix on error
            }
        }

        let prefixUsed: string | undefined;

        // 2. Determine if a valid prefix was used (Custom/Default vs Mention)
        if (message.content.startsWith(activePrefix)) {
            prefixUsed = activePrefix;
        } else if (config.allowMentionAsPrefix) {
            const mention = userMention(client.user.id);
            if (message.content.startsWith(mention)) {
                prefixUsed = message.content.startsWith(`${mention} `) ? `${mention} ` : mention;
            }
        }

        if (!prefixUsed) return;

        // 3. Extract trigger and raw arguments
        const contentWithoutPrefix = message.content.slice(prefixUsed.length).trim();
        const args = contentWithoutPrefix.split(/\s+/);
        const trigger = args.shift();

        if (!trigger) return;

        // 4. Resolve the builder
        const command = client.commands.prefix.get(trigger);
        if (!command) return;

        // 5. Cleanup content and Run
        message.content = args.join(" ");

        try {
            return await command.run(client, client, message);
        } catch (err) {
            await sendCommandErrorEmbed(client, err as Error, message.guild, message);
            throw err;
        }
    }
});
