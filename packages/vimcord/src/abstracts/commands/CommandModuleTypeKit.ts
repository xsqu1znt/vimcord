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
    User,
    UserContextMenuCommandInteraction
} from "discord.js";
import type { Vimcord } from "@/client/Vimcord.js";
import type { CommandRestrictions, PermissionTestResult } from "@/commands/commandPermissions.js";
import type {
    ModuleBlock,
    ModuleContext,
    ModuleHookContext,
    ModuleHooks,
    ModuleMetadata,
    ModuleOptions
} from "../AbstractModule.js";
import type { AbstractCommandModule } from "./AbstractCommandModule.js";

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
        contextExtras: {
            interaction: ChatInputCommandInteraction;
            /** Matched `subcommands` key, or null when the parent handler runs. */
            subcommand: string | null;
        };
        /** What `guildOnly: true` guarantees. */
        guildExtras: { interaction: ChatInputCommandInteraction<"raw" | "cached"> };
    };

    // Prefix Command
    [CommandModuleType.Prefix]: {
        args: [message: Message, prefix: string, trigger: string];
        contextExtras: {
            message: Message;
            prefix: string;
            trigger: string;
            /** Matched canonical subcommand name, or null when using the parent handler. */
            subcommand: string | null;
            /** Message text after the command and any subcommand. For a custom separator, use `content.split("|")`. */
            content: string;
            /** `content` split on whitespace. Computed on first read. */
            readonly args: string[];
            /** `args` in lowercase. Computed on first read. */
            readonly lowerArgs: string[];
        };
        guildExtras: { message: Message<true> };
    };

    // TODO: Verify internally if the correct context type is set on the builder

    // Message Context Menu Command
    [CommandModuleType.MessageContext]: {
        args: [interaction: MessageContextMenuCommandInteraction];
        contextExtras: { interaction: MessageContextMenuCommandInteraction };
        guildExtras: { interaction: MessageContextMenuCommandInteraction<"raw" | "cached"> };
    };

    // User Context Menu Command
    [CommandModuleType.UserContext]: {
        args: [interaction: UserContextMenuCommandInteraction];
        contextExtras: { interaction: UserContextMenuCommandInteraction };
        guildExtras: { interaction: UserContextMenuCommandInteraction<"raw" | "cached"> };
    };
}

export type CommandModuleArgs<T extends CommandModuleType> = CommandTypeMap[T]["args"];

// --- Contexts ---
export type CommandModuleContext<T extends CommandModuleType> = ModuleContext & {
    /** The user who invoked the command. */
    user: User;
} & CommandTypeMap[T]["contextExtras"];

/** The context a handler receives when `guildOnly: true` guarantees a guild. */
export type GuildCommandModuleContext<T extends CommandModuleType> = Omit<
    CommandModuleContext<T>,
    keyof CommandTypeMap[T]["guildExtras"]
> &
    CommandTypeMap[T]["guildExtras"];

type ScopedContext<T extends CommandModuleType, InGuild extends boolean> = InGuild extends true
    ? GuildCommandModuleContext<T>
    : CommandModuleContext<T>;

/** `module` is the running command module, so its metadata (including augmented fields) is typed. */
export type CommandModuleHookContext<T extends CommandModuleType> = CommandModuleContext<T> &
    ModuleHookContext<CommandModuleArgs<T>, true, AbstractCommandModule<T>>;

// --- Hooks ---
/** Why a command invocation stopped before reaching its handler. */
export type CommandBlock =
    | ModuleBlock
    | ({ kind: "permission" } & Omit<Extract<PermissionTestResult, { passed: false }>, "passed">)
    | {
          kind: "unknownRoute";
          /** The subcommand path that matched nothing. Empty when a prefix command got no subcommand token. */
          path: string;
      };

export type CommandModuleHooks<T extends CommandModuleType> = ModuleHooks<
    CommandModuleArgs<T>,
    CommandModuleHookContext<T>,
    CommandBlock
>;

// --- Command Module Options ---
/** Everything a command module takes except its handlers and `guildOnly`, which decide the handlers' context. */
export type CommandModuleBaseOptions<T extends CommandModuleType> = Omit<
    ModuleOptions<CommandModuleArgs<T>, CommandModuleContext<T>, CommandModuleHookContext<T>, CommandModuleHooks<T>>,
    "singleInvocation" | "execute"
> &
    Omit<CommandRestrictions, "guildOnly"> & {
        metadata?: CommandModuleMetadata;
        hooks?: CommandModuleHooks<T>;
        /**
         * Skip a new invocation while a matching one is still running. Off by default.
         * `true` keys on the module and the invoking user. Pass a `key` function for custom scoping.
         */
        singleInvocation?: boolean | { key(ctx: CommandModuleHookContext<T>): string };
    };

/** Splits options on `guildOnly`, so handlers only see the guild context when it's guaranteed. */
export type GuildOnlyOptions<InGuild, Anywhere> =
    | ({
          /** Blocks the command outside guilds and narrows the handler context to guarantee a guild. */
          guildOnly: true;
      } & InGuild)
    | ({ guildOnly?: false } & Anywhere);

export interface CommandModuleMetadata extends ModuleMetadata {
    /** Command emoji. */
    emoji?: string;
    /** Command usage examples. */
    examples?: string[];
    /**
     * Hide this command.
     * @default false
     */
    hidden?: boolean;
}

// --- Subcommands ---
/** Subcommand fields with its handler, whose context is the guild one when the parent or subcommand is `guildOnly`. */
type ScopedSubcommand<T extends CommandModuleType, Fields, InGuild extends boolean> = Omit<
    CommandRestrictions,
    "guildOnly"
> &
    Fields &
    (InGuild extends true
        ? { guildOnly?: boolean; handler(ctx: GuildCommandModuleContext<T>): Promise<unknown> | unknown }
        : | { guildOnly: true; handler(ctx: GuildCommandModuleContext<T>): Promise<unknown> | unknown }
          | { guildOnly?: false; handler(ctx: CommandModuleContext<T>): Promise<unknown> | unknown });

/** A subcommand as stored on its module, with its handler no longer split by `guildOnly`. */
export type ResolvedSubcommand<T extends CommandModuleType, Fields> = CommandRestrictions &
    Fields & { handler(ctx: CommandModuleContext<T>): Promise<unknown> | unknown };

interface PrefixSubcommandFields {
    aliases?: string[];
    description?: string;
}

interface SlashSubcommandFields {
    /** Defer this subcommand's reply. Falls back to the command's `deferReply`; `false` turns it off for this subcommand. */
    deferReply?: CommandDeferReply;
    /** Autocomplete handler for this subcommand's options. */
    autocomplete?: SlashCommandAutocompleteHandler;
}

/** One prefix subcommand. Its restrictions apply after the command's own pass. */
export type PrefixCommandModuleSubcommand<InGuild extends boolean = false> = ScopedSubcommand<
    CommandModuleType.Prefix,
    PrefixSubcommandFields,
    InGuild
>;
export type ResolvedPrefixSubcommand = ResolvedSubcommand<CommandModuleType.Prefix, PrefixSubcommandFields>;

/** One slash subcommand. Its restrictions apply after the command's own pass. */
export type SlashCommandModuleSubcommand<InGuild extends boolean = false> = ScopedSubcommand<
    CommandModuleType.Slash,
    SlashSubcommandFields,
    InGuild
>;
export type ResolvedSlashSubcommand = ResolvedSubcommand<CommandModuleType.Slash, SlashSubcommandFields>;

/** Handlers shared by prefix and slash commands. `T`'s subcommands use `group:subcommand` keys on slash. */
type RoutedHandlers<T extends CommandModuleType, Subcommand, InGuild extends boolean> = {
    /** Runs when no subcommand matches. Required when `subcommands` is omitted. */
    execute?(ctx: ScopedContext<T, InGuild>): unknown;
    subcommands?: Record<string, Subcommand>;
};

// --- App Command Module Types ---
export type CommandDeferReply = boolean | "ephemeral";

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

/** Options shared by every application command. */
export type AppCommandModuleBaseOptions<T extends CommandModuleType> = Omit<
    CommandModuleBaseOptions<T>,
    "name" | "description"
> & {
    /** Defer the reply. */
    deferReply?: CommandDeferReply;
    /** Client command registration rules. Global is `true` by default. */
    registration?: AppCommandRegistrationRules;
};

// --- Concrete Module Options ---
export type PrefixCommandModuleOptions = CommandModuleBaseOptions<CommandModuleType.Prefix> & {
    aliases?: string[];
} & GuildOnlyOptions<
        RoutedHandlers<CommandModuleType.Prefix, PrefixCommandModuleSubcommand<true>, true>,
        RoutedHandlers<CommandModuleType.Prefix, PrefixCommandModuleSubcommand, false>
    >;

export type SlashCommandModuleOptions = AppCommandModuleBaseOptions<CommandModuleType.Slash> & {
    builder: SlashCommandBuilderResolvable | ((builder: SlashCommandBuilder) => SlashCommandBuilderResolvable);
    autocomplete?: SlashCommandAutocompleteHandler;
} & GuildOnlyOptions<
        RoutedHandlers<CommandModuleType.Slash, SlashCommandModuleSubcommand<true>, true>,
        RoutedHandlers<CommandModuleType.Slash, SlashCommandModuleSubcommand, false>
    >;

export type ContextCommandModuleOptions<T extends CommandModuleType.MessageContext | CommandModuleType.UserContext> =
    AppCommandModuleBaseOptions<T> & {
        builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
    } & GuildOnlyOptions<
            { execute(ctx: GuildCommandModuleContext<T>): unknown },
            { execute(ctx: CommandModuleContext<T>): unknown }
        >;
