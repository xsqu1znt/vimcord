import { EventModule } from "vimcord";

export default new EventModule({
    event: "messageCreate",
    name: "CommandDispatch:Prefix",
    metadata: {
        category: ["Commands"],
        tags: ["prefix"]
    },

    async execute({ client, args: [message] }) {
        const PREFIX = ";";
        await client.modules.commands.dispatchMessage(message, PREFIX);
    }
});
