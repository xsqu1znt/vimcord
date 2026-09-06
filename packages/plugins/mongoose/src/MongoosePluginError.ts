import { PluginError } from "vimcord";

export class MongoosePluginError extends PluginError {
    constructor(message: string) {
        super(message);
        this.name = "MongoosePluginError";
    }
}
