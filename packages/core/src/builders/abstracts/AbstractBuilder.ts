import { humanId } from "human-id";

export interface AbstractBuilderOptions {
    /** Custom client id. Otherwise powered by [human-id](https://www.npmjs.com/package/human-id). */
    customId?: string;
    name: string;
}

export class AbstractBuilder {
    readonly id: string;
    readonly name: string;

    constructor(options: AbstractBuilderOptions) {
        const { customId, name } = options;
        this.id = customId ?? humanId({ separator: "-", capitalize: false });
        this.name = name;
    }
}
