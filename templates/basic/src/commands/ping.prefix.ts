import { PrefixCommandModule } from "vimcord";

export default new PrefixCommandModule({
    name: "ping",
    async execute({ message }) {
        await message.reply("Pong!");
    }
});
