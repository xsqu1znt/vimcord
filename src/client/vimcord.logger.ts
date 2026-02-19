import { Logger } from "@/tools/Logger";
import chalk from "chalk";
import { version } from "../../package.json";
import { Vimcord } from "./Vimcord";

export const clientLoggerFactory = (client: Vimcord) =>
    new Logger({ prefixEmoji: "⚡", prefix: `vimcord (i${client.clientId})` }).extend({
        clientBanner(client: Vimcord) {
            if (client.config.app.disableBanner) return;

            const border = "═".repeat(50);
            console.log(chalk.hex(this.colors.primary)(`\n╔${border}╗`));
            console.log(
                chalk.hex(this.colors.primary)("║") +
                    chalk.bold.hex(this.colors.text)(
                        `  🚀 ${client.$name} v${client.$version}`.padEnd(50 - (client.$devMode ? 12 : 0))
                    ) +
                    chalk.hex(this.colors.primary)(`${client.$devMode ? chalk.hex(this.colors.warn)("devMode ⚠️   ") : ""}║`)
            );

            console.log(chalk.hex(this.colors.primary)(`║${"".padEnd(50)}║`));

            console.log(
                chalk.hex(this.colors.primary)("║") +
                    chalk.hex(this.colors.muted)(
                        `  # Powered by Vimcord v${version}`.padEnd(50 - 3 - `${client.clientId}`.length)
                    ) +
                    chalk.hex(this.colors.primary)(`${chalk.hex(this.colors.muted)(`i${client.clientId}`)}  ║`)
            );
            console.log(chalk.hex(this.colors.primary)(`╚${border}╝\n`));
        },

        clientReady(clientTag: string, guildCount: number) {
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex(this.colors.success)("🤖 READY"),
                chalk.white(`Connected as ${chalk.bold.hex(this.colors.primary)(clientTag)}`),
                chalk.hex(this.colors.muted)(`• ${guildCount} guilds`)
            );
        },

        moduleLoaded(moduleName: string, count?: number, ignoredCount?: number): void {
            const countText = count ? chalk.hex(this.colors.muted)(`(${count} items)`) : "";
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#9B59B6")("📦 MODULE"),
                chalk.hex(this.colors.warn)(`${moduleName} loaded`),
                ignoredCount ? chalk.hex(this.colors.muted)(`(${ignoredCount} ignored)`) : "",
                countText
            );
        },

        commandExecuted(commandName: string, username: string, guildName?: string) {
            const location = guildName ? `in ${chalk.hex(this.colors.muted)(guildName)}` : "in DMs";
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#87CEEB")("📝 COMMAND"),
                chalk.hex(this.colors.warn)(`/${commandName}`),
                chalk.white(`used by ${chalk.bold(username)}`),
                chalk.hex(this.colors.muted)(location)
            );
        },

        plugin(pluginName: string, action: string, details?: string) {
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#FF6B9D")(`🔌 ${pluginName}`),
                chalk.white(action),
                details ? chalk.hex(this.colors.muted)(details) : ""
            );
        },

        database(action: string, details?: string) {
            console.log(
                this.formatTimestamp(),
                this.formatPrefix(),
                chalk.hex("#FF6B9D")("🗄️  DATABASE"),
                chalk.white(action),
                details ? chalk.hex(this.colors.muted)(details) : ""
            );
        }
    });
