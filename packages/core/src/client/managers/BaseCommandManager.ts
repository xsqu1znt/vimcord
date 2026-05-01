import type { AbstractCommandModule, CommandModuleType } from "@/abstracts/AbstractCommandModule.js";
import type { Vimcord } from "../Vimcord.js";

import { AbstractModuleImporter } from "@/abstracts/AbstractModuleImporter.js";

type CommandModuleIndexType = "name" | "category" | "tag" | "alias";

export interface CommandFilter {
    names?: string[];
    category?: string;
    tag?: string;
}

export abstract class BaseCommandManager<
    K extends CommandModuleType = CommandModuleType,
    T extends AbstractCommandModule<K> = AbstractCommandModule<K>
> extends AbstractModuleImporter<T, CommandModuleIndexType> {
    constructor(client: Vimcord, fileSuffix?: string | string[]) {
        super(client, fileSuffix);

        this.indexes.set("name", { key: m => m.name.toLowerCase(), map: new Map() });
        this.indexes.set("category", { key: m => m.metadata.category, map: new Map(), isArray: true });
        this.indexes.set("tag", { key: m => m.metadata.tags, map: new Map(), isArray: true });
    }

    protected override createModuleKey(module: T): string {
        return module.id;
    }

    override clear(): void {
        this.modules.clear();
        this.reindex();
    }

    override get(id: string): T | undefined {
        return this.modules.get(id);
    }

    getAll(options: CommandFilter = {}): T[] {
        return Array.from(this.modules.values()).filter(command => {
            if (options.names?.length && !options.names.includes(command.name)) return false;
            if (options.category && !command.metadata.category?.includes(options.category)) return false;
            if (options.tag && !command.metadata.tags?.includes(options.tag)) return false;
            return true;
        });
    }

    getByName(name: string): T | undefined {
        return this.getIndex("name", name.toLowerCase());
    }

    getByCategory(category: string): T[] {
        return this.getIndex("category", category, true);
    }

    getByTag(tag: string): T[] {
        return this.getIndex("tag", tag, true);
    }

    register(...commands: T[]): void {
        commands.forEach(command => {
            if (this.modules.has(command.id)) {
                throw new Error(`Duplicate command module key '${command.id}'`);
            }

            command.inject(this.client);
            this.modules.set(command.id, command);
        });

        this.reindex();
        commands.forEach(command =>
            this.client.logger.debugVerbose(`[CommandManager] Registered '${command.name}' (${command.id})`)
        );
    }

    unregister(...ids: string[]): void {
        const commands = ids.map(id => this.modules.get(id)).filter((command): command is T => Boolean(command));
        if (!commands.length) return;

        commands.forEach(command => this.modules.delete(command.id));
        this.reindex();
        commands.forEach(command =>
            this.client.logger.debugVerbose(`[CommandManager] Unregistered '${command.name}' (${command.id})`)
        );
    }
}
