import { EventBuilder } from "@/builders/event.builder";
import { sendCommandErrorEmbed } from "@/utils/sendCommandErrorEmbed";

export const BUILTIN_ContextCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "ContextCommandHandler",
    async execute(client, interaction) {
        // 1. Ensure it is a Context Menu interaction (User or Message)
        if (!interaction.isContextMenuCommand()) return;

        // 2. Resolve the builder from our Context Manager
        const command = client.commands.context.get(interaction.commandName);

        // 3. Handle unknown context commands
        if (!command) {
            const content = `**${interaction.commandName}** is not a registered context command.`;

            // Standard safety check for deferred/replied states
            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ content, flags: "Ephemeral" });
            }
            return interaction.reply({ content, flags: "Ephemeral" });
        }

        try {
            return await command.run(client, client, interaction);
        } catch (err) {
            await sendCommandErrorEmbed(client, err as Error, interaction.guild, interaction);
            throw err;
        }
    }
});
