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

/** Command module kinds supported by Vimcord. */
export enum CommandModuleType {
    Slash = "Slash",
    Prefix = "Prefix",
    MessageContext = "MessageContext",
    UserContext = "UserContext"
}

export type SlashCommandBuilderResolvable =
    SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

/** Client, interaction, and focused option supplied to autocomplete. */
export interface SlashCommandAutocompleteContext {
    /** Client that owns or runs this operation. */
    client: Vimcord<true>;
    /** Discord interaction that triggered the handler. */
    interaction: AutocompleteInteraction;
    /** The option the user is currently typing in. */
    focused: AutocompleteFocusedOption;
}

/** Returns the choices to respond with, or responds directly and returns nothing. */
export type SlashCommandAutocompleteHandler = (
    ctx: SlashCommandAutocompleteContext
) => Promise<ApplicationCommandOptionChoiceData[] | void> | ApplicationCommandOptionChoiceData[] | void;

/** Invocation arguments and context fields for each command kind. */
interface CommandTypeMap {
    // Slash Command
    /** Slash invocation arguments and context. */
    [CommandModuleType.Slash]: {
        /** Positional arguments supplied to the handler. */
        args: [interaction: ChatInputCommandInteraction];
        /** Invocation fields specific to this command kind. */
        contextExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: ChatInputCommandInteraction;
            /** Matched `subcommands` key, or null when the parent handler runs. */
            subcommand: string | null;
        };
        /** What `guildOnly: true` guarantees. */
        guildExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: ChatInputCommandInteraction<"raw" | "cached">;
        };
    };

    // Prefix Command
    /** Prefix invocation arguments and context. */
    [CommandModuleType.Prefix]: {
        /** Positional arguments supplied to the handler. */
        args: [message: Message, prefix: string, trigger: string];
        /** Invocation fields specific to this command kind. */
        contextExtras: {
            /** Discord message associated with the operation. */
            message: Message;
            /** Prefix matched at the start of the command message. */
            prefix: string;
            /** Command name or alias matched in the message. */
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
        /** Fields narrowed when the command requires a guild. */
        guildExtras: {
            /** Discord message associated with the operation. */
            message: Message<true>;
        };
    };

    // TODO: Verify internally if the correct context type is set on the builder

    // Message Context Menu Command
    /** Message context menu arguments and context. */
    [CommandModuleType.MessageContext]: {
        /** Positional arguments supplied to the handler. */
        args: [interaction: MessageContextMenuCommandInteraction];
        /** Invocation fields specific to this command kind. */
        contextExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: MessageContextMenuCommandInteraction;
        };
        /** Fields narrowed when the command requires a guild. */
        guildExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: MessageContextMenuCommandInteraction<"raw" | "cached">;
        };
    };

    // User Context Menu Command
    /** User context menu arguments and context. */
    [CommandModuleType.UserContext]: {
        /** Positional arguments supplied to the handler. */
        args: [interaction: UserContextMenuCommandInteraction];
        /** Invocation fields specific to this command kind. */
        contextExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: UserContextMenuCommandInteraction;
        };
        /** Fields narrowed when the command requires a guild. */
        guildExtras: {
            /** Discord interaction that triggered the handler. */
            interaction: UserContextMenuCommandInteraction<"raw" | "cached">;
        };
    };
}

export type CommandModuleArgs<T extends CommandModuleType> = CommandTypeMap[T]["args"];

// --- Contexts ---
/** Invocation data for the selected command kind. */
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

/** Hook context of any command kind. `client`, `user`, and `module` are always there; `"interaction" in ctx` or `"message" in ctx` narrows it. */
export type AnyCommandHookContext = { [K in CommandModuleType]: CommandModuleHookContext<K> }[CommandModuleType];

// --- Hooks ---
/** Why a command invocation stopped before reaching its handler. */
export type CommandBlock =
    | ModuleBlock
    | ({
          /** Discriminator identifying the blocked invocation. */
          kind: "permission";
      } & Omit<
          Extract<
              PermissionTestResult,
              {
                  /** Whether the check passed. */
                  passed: false;
              }
          >,
          "passed"
      >)
    | {
          /** Discriminator identifying the blocked invocation. */
          kind: "unknownRoute";
          /** The subcommand path that matched nothing. Empty when a prefix command got no subcommand token. */
          path: string;
      };

/** Callbacks that gate commands and receive command blocks or errors. */
export type CommandModuleHooks<T extends CommandModuleType> = ModuleHooks<
    CommandModuleArgs<T>,
    CommandModuleHookContext<T>,
    CommandBlock
>;

/** Callbacks shared by every command kind, set through the client's `hooks.all`. */
export type AnyCommandModuleHooks = ModuleHooks<CommandModuleArgs<CommandModuleType>, AnyCommandHookContext, CommandBlock>;

// --- Command Module Options ---
/** Everything a command module takes except its handlers and `guildOnly`, which decide the handlers' context. */
export type CommandModuleBaseOptions<T extends CommandModuleType> = Omit<
    ModuleOptions<CommandModuleArgs<T>, CommandModuleContext<T>, CommandModuleHookContext<T>, CommandModuleHooks<T>>,
    "singleInvocation" | "execute"
> &
    Omit<CommandRestrictions, "guildOnly"> & {
        /** Project-defined display and categorization fields. */
        metadata?: CommandModuleMetadata;
        /** Callbacks for invocation gates, blocks, and errors. */
        hooks?: CommandModuleHooks<T>;
        /** Skips a new invocation while one with the same process-local key is running. @default false */
        singleInvocation?:
            | boolean
            | {
                  /** Returns the identity used to group matching invocations. */
                  key(ctx: CommandModuleHookContext<T>): string;
              };
    };

/** Splits options on `guildOnly`, so handlers only see the guild context when it's guaranteed. */
export type GuildOnlyOptions<InGuild, Anywhere> =
    | ({
          /** Whether to require invocation in a guild. @default false */
          guildOnly: true;
      } & InGuild)
    | ({
          /** Whether to require invocation in a guild. @default false */
          guildOnly?: false;
      } & Anywhere);

/** Command presentation metadata and project-defined fields. */
export interface CommandModuleMetadata extends ModuleMetadata {
    /** Command emoji. */
    emoji?: string;
    /** Command usage examples. */
    examples?: string[];
    /** Hide this command. @default false */
    hidden?: boolean;
}

// --- Subcommands ---
/** Subcommand fields with its `execute`, whose context is the guild one when the parent or subcommand is `guildOnly`. */
type ScopedSubcommand<T extends CommandModuleType, Fields, InGuild extends boolean> = Omit<
    CommandRestrictions,
    "guildOnly"
> &
    Fields &
    (InGuild extends true
        ? {
              /** Whether to require invocation in a guild. @default false */
              guildOnly?: boolean;
              /** Runs the matched subcommand after its restrictions pass. */
              execute(ctx: GuildCommandModuleContext<T>): Promise<unknown> | unknown;
          }
        : | {
                /** Whether to require invocation in a guild. @default false */
                guildOnly: true;
                /** Runs the matched subcommand after its restrictions pass. */
                execute(ctx: GuildCommandModuleContext<T>): Promise<unknown> | unknown;
            }
          | {
                /** Whether to require invocation in a guild. @default false */
                guildOnly?: false;
                /** Runs the matched subcommand after its restrictions pass. */
                execute(ctx: CommandModuleContext<T>): Promise<unknown> | unknown;
            });

/** A subcommand as stored on its module, with its `execute` no longer split by `guildOnly`. */
export type ResolvedSubcommand<T extends CommandModuleType, Fields> = CommandRestrictions &
    Fields & { execute(ctx: CommandModuleContext<T>): Promise<unknown> | unknown };

/** Aliases and description for a prefix subcommand. */
interface PrefixSubcommandFields {
    /** Additional lowercase triggers for the prefix command. @default [] */
    aliases?: string[];
    /** Short description displayed to users or in discovery. */
    description?: string;
}

/** Deferral and autocomplete overrides for a slash subcommand. */
interface SlashSubcommandFields {
    /** Defers before the handler; "ephemeral" defers privately. @default false */
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
    /** Handlers keyed by subcommand name or slash group:subcommand path. */
    subcommands?: Record<string, Subcommand>;
};

// --- App Command Module Types ---
export type CommandDeferReply = boolean | "ephemeral";

/** Scopes used when registering an application command. */
export interface AppCommandRegistrationRules {
    /** Register this command in these guilds. Startup sync pushes it there. */
    guilds?: GuildResolvable[];
    /** Register this command globally. @default true, or false when `guilds` is set */
    global?: boolean;
}

/** Registration scopes after defaults, so `global` is always decided. */
export type ResolvedAppCommandRegistration = AppCommandRegistrationRules & {
    /** Whether this command is registered globally. */
    global: boolean;
};

/** Options shared by every application command. */
export type AppCommandModuleBaseOptions<T extends CommandModuleType> = Omit<
    CommandModuleBaseOptions<T>,
    "name" | "description"
> & {
    /** Defers before the handler; "ephemeral" defers privately. @default false */
    deferReply?: CommandDeferReply;
    /** Guild and global application command registration scopes. */
    registration?: AppCommandRegistrationRules;
};

// --- Concrete Module Options ---
/** Prefix triggers, restrictions, hooks, and routed handlers. */
export type PrefixCommandModuleOptions = CommandModuleBaseOptions<CommandModuleType.Prefix> & {
    /** Additional lowercase triggers for the prefix command. @default [] */
    aliases?: string[];
} & GuildOnlyOptions<
        RoutedHandlers<CommandModuleType.Prefix, PrefixCommandModuleSubcommand<true>, true>,
        RoutedHandlers<CommandModuleType.Prefix, PrefixCommandModuleSubcommand, false>
    >;

/** Slash builder, restrictions, autocomplete, and routed handlers. */
export type SlashCommandModuleOptions = AppCommandModuleBaseOptions<CommandModuleType.Slash> & {
    /** Discord.js builder or callback configuring the application command. */
    builder: SlashCommandBuilderResolvable | ((builder: SlashCommandBuilder) => SlashCommandBuilderResolvable);
    /** Handler returning choices for the focused slash option. */
    autocomplete?: SlashCommandAutocompleteHandler;
} & GuildOnlyOptions<
        RoutedHandlers<CommandModuleType.Slash, SlashCommandModuleSubcommand<true>, true>,
        RoutedHandlers<CommandModuleType.Slash, SlashCommandModuleSubcommand, false>
    >;

/** Context menu builder, restrictions, and target handler. */
export type ContextCommandModuleOptions<T extends CommandModuleType.MessageContext | CommandModuleType.UserContext> =
    AppCommandModuleBaseOptions<T> & {
        /** Discord.js builder or callback configuring the application command. */
        builder: ContextMenuCommandBuilder | ((builder: ContextMenuCommandBuilder) => ContextMenuCommandBuilder);
    } & GuildOnlyOptions<
            {
                /** Runs the module or command handler. */
                execute(ctx: GuildCommandModuleContext<T>): unknown;
            },
            {
                /** Runs the module or command handler. */
                execute(ctx: CommandModuleContext<T>): unknown;
            }
        >;
