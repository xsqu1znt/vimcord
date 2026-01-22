import { EventBuilder } from "@/builders/event.builder";
import { sendCommandErrorEmbed } from "@/utils/sendCommandErrorEmbed";

export const BUILTIN_SlashCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "SlashCommandHandler",
    async execute(client, interaction) {
        // 1. Ensure it's a Chat Input (Slash) command
        if (!interaction.isChatInputCommand()) return;

        // 2. Fetch the builder from our refactored manager
        const command = client.commands.slash.get(interaction.commandName);

        // 3. Handle unknown commands
        if (!command) {
            const content = `**/\`${interaction.commandName}\`** is not a registered command.`;

            // Safety check: if the interaction was somehow already deferred/replied
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
