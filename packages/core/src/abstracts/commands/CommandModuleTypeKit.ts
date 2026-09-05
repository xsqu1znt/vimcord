import type {
    ApplicationCommandOptionChoiceData,
    AutocompleteFocusedOption,
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    ContextMenuCommandBuilder,
    GuildResolvable,
    Message,
    MessageContextMenuCommandInteraction,
    SlashCommandBuilder,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder,
    UserContextMenuCommandInteraction
} from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CommandModulePermissions, PermissionTestResult } from "@/commands/commandPermissions.js";
import type { ModuleContext, ModuleHookContext, ModuleHooks, ModuleMetadata, ModuleOptions } from "../AbstractModule.js";

export enum CommandModuleType {
    Slash = "Slash",
    Prefix = "Prefix",
    MessageContext = "MessageContext",
    UserContext = "UserContext"
}

export type SlashCommandBuilderResolvable =
    SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface SlashCommandAutocompleteContext {
    client: Vimcord<true>;
    interaction: AutocompleteInteraction;
    /** The option the user is currently typing in. */
    focused: AutocompleteFocusedOption;
}

/** Returns the choices to respond with, or responds directly and returns nothing. */
export type SlashCommandAutocompleteHandler = (
    ctx: SlashCommandAutocompleteContext
) => Promise<ApplicationCommandOptionChoiceData[] | void> | ApplicationCommandOptionChoiceData[] | void;

interface CommandTypeMap {
    // Slash Command
    [CommandModuleType.Slash]: {
        args: [interaction: ChatInputCommandInteraction];
        optionExtras: AppCommandModuleOptionExtras & {
            builder: SlashCommandBuilderResolvable | ((builder: SlashCommandBuilder) => SlashCommandBuilderResolvable);
            routes?: SlashCommandModuleRoute[];
            autocomplete?: SlashCommandAutocompleteHandler;
        };
        contextExtras: { interaction: ChatInputCommandInteraction };
        hookContextExtras: Record<never, never>;
        hookExtras: {
            onUnknownRoute?(
                ctx: CommandModuleHookContext<CommandModuleType.Slash>,
                path: string
            ): Promise<unknown> | unknown;
        };
    };

    // Prefix Command
    [CommandModuleType.Prefix]: {
        args: [message: Message, prefix: string, trigger: string];
        optionExtras: {
            aliases?: string[];
            description?: string;
        };
        contextExtras: {
            message: Message;
            messageContent: string;
            prefix: string;
            trigger: string;
            splitContent: (options?: { separator?: string; lowercase?: boolean; uppercase?: boolean }) => string[];
        };
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };

    // TODO: Verify internally if the correct context type is set on the builder

    // Message Context Menu Command
    [CommandModuleType.MessageContext]: {
        args: [interaction: MessageContextMenuCommandInteraction];
        optionExtras: AppCommandModuleOptionExtras & {
            builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
        };
        contextExtras: { interaction: MessageContextMenuCommandInteraction };
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };

    // User Context Menu Command
    [CommandModuleType.UserContext]: {
        args: [interaction: UserContextMenuCommandInteraction];
        optionExtras: AppCommandModuleOptionExtras & {
            builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
        };
        contextExtras: { interaction: UserContextMenuCommandInteraction };
        hookContextExtras: Record<never, never>;
        hookExtras: Record<never, never>;
    };
}

export type CommandModuleArgs<T extends CommandModuleType> = CommandTypeMap[T]["args"];

export type CommandModuleContext<T extends CommandModuleType> = ModuleContext & CommandTypeMap[T]["contextExtras"];
export type CommandModuleHookContext<T extends CommandModuleType> = CommandModuleContext<T> &
    ModuleHookContext<CommandModuleArgs<T>> & {
        permissionTestResult?: PermissionTestResult;
    } & CommandTypeMap[T]["hookContextExtras"];

export type CommandModuleHooks<T extends CommandModuleType> = ModuleHooks<
    CommandModuleArgs<T>,
    CommandModuleHookContext<T>
> & {
    /** @defaultBehavior Alias for `onError`. */
    onPermissionTestFail?(ctx: CommandModuleHookContext<T>): Promise<void>;
} & CommandTypeMap[T]["hookExtras"];

// --- Command Module Options ---
export type CommandModuleOptions<T extends CommandModuleType> = ModuleOptions<
    CommandModuleArgs<T>,
    CommandModuleContext<T>,
    CommandModuleHookContext<T>,
    CommandModuleHooks<T>
> & {
    metadata?: CommandModuleMetadata;
    /** The permissions of the module. */
    permissions?: CommandModulePermissions;
    hooks?: CommandModuleHooks<T>;
} & CommandTypeMap[T]["optionExtras"];

export interface CommandModuleMetadata extends ModuleMetadata {
    /**
     * Command category emoji.
     * @remarks I recommend mapping your own category emojis separately instead of using this.
     */
    categoryEmoji?: string;
    /** Command emoji. */
    emoji?: string;
    /** Command usage examples. */
    examples?: string[];
    /**
     * Hide this command.
     * @default false
     */
    hidden?: boolean;
    /** Log this command's usage when it runs through the built-in dispatchers.
     * @default true */
    logUsage?: boolean;
}

// --- App Command Module Types ---
export type AppCommandModuleOptions<T extends CommandModuleType> = Omit<CommandModuleOptions<T>, "name" | "description">;

interface AppCommandModuleOptionExtras {
    /** Defer the reply. */
    deferReply?: boolean | { flags?: "Ephemeral" };
    /** Client command registration rules. Global is `true` by default. */
    registration?: AppCommandRegistrationRules;
}

interface AppCommandRegistrationRules {
    /** Only register this command to these guilds.
     * @remarks This only applies when registering locally.
     */
    guilds?: GuildResolvable[];
    /**
     * Allow registering globally.
     * @default true
     */
    global?: boolean;
}

// --- Slash Command Module Types ---
export interface SlashCommandModuleRoute {
    /** Subcommand route path. Use `group:subcommand` for grouped subcommands. */
    path: string;
    deferReply?: AppCommandModuleOptionExtras["deferReply"];
    /** Slash command route handler. This is what gets executed. */
    handler(ctx: CommandModuleContext<CommandModuleType.Slash>): Promise<unknown> | unknown;
    /** Autocomplete handler for this route's options. */
    autocomplete?: SlashCommandAutocompleteHandler;
}
