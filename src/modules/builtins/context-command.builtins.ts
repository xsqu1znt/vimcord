import { EventBuilder } from "@/builders/event.builder";

export const contextCommandHandler = new EventBuilder({
    event: "interactionCreate",
    name: "ContextCommandHandler",
    async execute(client, interaction) {
        if (!interaction.isContextMenuCommand()) return;

        const command = client.commands.context.get(interaction.commandName);

        if (!command) {
            const content = `**${interaction.commandName}** is not a registered context command.`;

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
