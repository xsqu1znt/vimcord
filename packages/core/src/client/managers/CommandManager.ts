import type { CommandModule } from "@/modules/CommandModule.js";

import { AbstractModuleImporter } from "@/abstracts/AbstractModuleImporter.js";

type CommandModuleIndexType = "name" | "category" | "tag";

export class CommandManager extends AbstractModuleImporter<CommandModule, CommandModuleIndexType> {
    //
}
