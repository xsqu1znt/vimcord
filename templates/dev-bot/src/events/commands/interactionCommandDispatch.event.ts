import { EventModule } from "vimcord";

export default new EventModule({
    event: "interactionCreate",
    name: "CommandDispatch:Interaction",
    metadata: { category: ["Commands"], tags: ["slash", "context"] },
    requiresReady: true,

    async execute({ client, args: [interaction] }) {
        await client.modules.commands.dispatchInteraction(interaction);
    }
});
