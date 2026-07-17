import type { ParsedCLICommand } from "./types.js";

/** Splits a CLI line while preserving quoted values and simple backslash escapes. */
function tokenizeCLIInput(input: string): string[] {
    const tokens: string[] = [];
    let token = "";
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (const character of input) {
        if (escaped) {
            token += character;
            escaped = false;
            continue;
        }

        if (character === "\\") {
            escaped = true;
            continue;
        }

        if (quote) {
            if (character === quote) quote = null;
            else token += character;
            continue;
        }

        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }

        if (/\s/.test(character)) {
            if (token) {
                tokens.push(token);
                token = "";
            }
            continue;
        }

        token += character;
    }

    if (quote) throw new Error("Unterminated quoted value");
    if (escaped) token += "\\";
    if (token) tokens.push(token);

    return tokens;
}

/** Parses one slash-prefixed stdin line into a command, positionals, and long flags. */
export function parseCLIInput(input: string): ParsedCLICommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;

    const tokens = tokenizeCLIInput(trimmed.slice(1));
    const commandName = tokens.shift()?.toLowerCase();
    if (!commandName) return null;

    const args: string[] = [];
    const flags = new Map<string, string[]>();

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (!token.startsWith("--")) {
            args.push(token);
            continue;
        }

        const flag = token.slice(2);
        const separator = flag.indexOf("=");
        const name = (separator === -1 ? flag : flag.slice(0, separator)).toLowerCase();
        if (!name) throw new Error("CLI flags must have a name");

        const values = flags.get(name) ?? [];
        if (separator !== -1) {
            values.push(flag.slice(separator + 1));
        } else {
            // Long flags consume values until the next flag. Place positional command arguments before flags.
            while (tokens[index + 1] && !tokens[index + 1]!.startsWith("--")) {
                values.push(tokens[++index]!);
            }
        }
        flags.set(name, values);
    }

    return { name: commandName, args, flags };
}

/** Returns whether a boolean-style flag was provided. */
export function hasCLIFlag(flags: ReadonlyMap<string, readonly string[]>, name: string): boolean {
    return flags.has(name.toLowerCase());
}

/** Returns every value passed to a flag. */
export function getCLIFlagValues(flags: ReadonlyMap<string, readonly string[]>, name: string): readonly string[] {
    return flags.get(name.toLowerCase()) ?? [];
}

/** Returns the first value passed to a flag. */
export function getCLIFlagValue(flags: ReadonlyMap<string, readonly string[]>, name: string): string | undefined {
    return getCLIFlagValues(flags, name)[0];
}
