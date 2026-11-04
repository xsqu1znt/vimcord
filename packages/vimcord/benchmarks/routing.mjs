// Previous quick-start routing, retained as the authoring baseline.
export function manualRouting(client) {
    client.on("interactionCreate", interaction => {
        void client.modules.commands.dispatchInteraction(interaction);
    });
    client.on("messageCreate", message => {
        if (message.author.bot) return;
        void client.modules.commands.dispatchMessage(message, ["!"]);
    });
}

export function mountedRouting(client) {
    client.modules.commands.mount({ prefixes: ["!"] });
}
