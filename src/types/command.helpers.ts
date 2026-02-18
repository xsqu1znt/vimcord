import { ContextCommandBuilder } from "@/builders/context-command.builder";
import { PrefixCommandBuilder } from "@/builders/prefix-command.builder";
import { SlashCommandBuilder } from "@/builders/slash-command.builder";
import { CommandType } from "@ctypes/command.base";

export type VimcordCommandBuilderByType<T extends CommandType> = T extends CommandType.Slash
    ? SlashCommandBuilder
    : T extends CommandType.Context
      ? ContextCommandBuilder
      : T extends CommandType.Prefix
        ? PrefixCommandBuilder
        : never;
