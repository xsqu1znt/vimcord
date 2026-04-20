import { EventBuilder } from "@/builders/event.builder";

export const slashCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "SlashCommandHandler",
    async execute(client, interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.slash.get(interaction.commandName);

        if (!command) {
            const content = `**/\`${interaction.commandName}\`** is not a registered command.`;

            if (interaction.replied || interaction.deferred) {
                return interaction.followUp({ content, flags: "Ephemeral" });
            }
            return interaction.reply({ content, flags: "Ephemeral" });
        }

        try {
            return await command.run(client, client, interaction);
        } catch (err) {
            await client.error.handleCommandError(err as Error, interaction.guild, interaction);
        }
    }
});
