import { EventModule } from "vimcord";

export default new EventModule({
    event: "clientReady",
    name: "Ready:LoadedModules",

    async execute({ client }) {
        const slashCommands = client.modules.commands.slash.getAll().length;
        const prefixCommands = client.modules.commands.prefix.getAll().length;
        const contextCommands = client.modules.commands.context.getAll().length;
        const events = client.modules.events.modules.size;

        client.logger.info(
            `[DevBot] Ready with ${slashCommands} slash command${slashCommands === 1 ? "" : "s"}, ${prefixCommands} prefix command${prefixCommands === 1 ? "" : "s"}, ${contextCommands} context command${contextCommands === 1 ? "" : "s"}, and ${events} event module${events === 1 ? "" : "s"}`
        );
    }
});
