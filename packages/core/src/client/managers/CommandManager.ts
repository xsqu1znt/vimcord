import type { AbstractCommandModule } from "@/modules/PrefixCommandModule.js";

import { AbstractModuleImporter } from "@/abstracts/AbstractModuleImporter.js";

type CommandModuleIndexType = "name" | "category" | "tag";

export class CommandManager extends AbstractModuleImporter<AbstractCommandModule, CommandModuleIndexType> {
    //
}
