import { ContextCommandBuilder } from "@builders/contextCommand.builder";
import { PrefixCommandBuilder } from "@builders/prefixCommand.builder";
import { SlashCommandBuilder } from "@builders/slashCommand.builder";
import { CommandType } from "@ctypes/command.base";

export type VimcordCommandBuilderByType<T extends CommandType> = T extends CommandType.Slash
    ? SlashCommandBuilder
    : T extends CommandType.Context
      ? ContextCommandBuilder
      : T extends CommandType.Prefix
        ? PrefixCommandBuilder
        : never;
