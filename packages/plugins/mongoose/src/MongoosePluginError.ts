import { PluginError } from "@vimcord/core";

export class MongoosePluginError extends PluginError {
    constructor(message: string) {
        super(message);
        this.name = "MongoosePluginError";
    }
}
