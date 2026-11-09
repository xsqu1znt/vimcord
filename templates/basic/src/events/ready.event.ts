import { EventModule } from "vimcord";

export default new EventModule({
    name: "ready",
    event: "clientReady",
    once: true,
    execute({ client }) {
        client.logger.info(`Logged in as ${client.user?.tag}`);
    }
});
