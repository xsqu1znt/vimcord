import { ApplicationCommandType, InteractionContextType } from "discord.js";
import { BetterModal, UserContextCommandModule } from "vimcord";

export default new UserContextCommandModule({
    builder: builder =>
        builder.setName("Reply").setContexts(InteractionContextType.Guild).setType(ApplicationCommandType.User),

    metadata: { category: ["Fun"] },
    permissions: { botStaffOnly: true },

    async execute({ interaction }) {
        const modalResult = await new BetterModal({
            title: "Write your message",
            components: [
                { textInput: { customId: "m_input", label: "Message", required: true } },
                { checkbox: { custom_id: "m_checkbox", label: "Reply to message?", default: true } }
            ]
        }).showAndAwait(interaction, { timeout: 60_000 });

        if (!modalResult) return;

        await modalResult.deferReply({ flags: "Ephemeral" });
        const messageContent = modalResult.getField<string>("m_input", true);
        const replyToMessage = modalResult.getField<boolean>("m_checkbox", true);

        // Fetch the target message
        if (replyToMessage) {
            const targetMessage = await interaction.channel?.messages.fetch(interaction.targetId);
            if (!targetMessage) return modalResult.reply({ content: "Could not the message to reply to." });

            // Reply to the target message
            await targetMessage.reply({ content: messageContent });
        } else {
            if (!modalResult.interaction.channel?.isSendable()) {
                return modalResult.reply({ content: "Could not send the message to the channel." });
            }

            // Send directly to the channel
            await modalResult.interaction.channel.send({ content: messageContent });
        }

        // Let the user know the operation was complete
        await modalResult.reply({ content: "Your message has been sent." });
    }
});
