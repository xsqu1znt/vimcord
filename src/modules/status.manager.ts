import { Vimcord } from "@/client";
import { Logger } from "@/tools/Logger";
import { fetchGuild } from "@/tools/utils";
import { ClientActivity, ClientStatus, createVimcordStatusConfig, VimcordClientStatus } from "@/types/status";
import { formatThousands } from "@/utils/number";
import { pickRandom } from "@/utils/random";
import cron, { ScheduledTask } from "node-cron";
import EventEmitter from "node:events";
import { $, Loop } from "qznt";
import { PartialDeep } from "type-fest";

type StatusManagerEvents = {
    changed: [ClientActivity];
    cleared: [];
    rotation: [ClientActivity];
    paused: [Loop];
    started: [Loop];
    destroyed: [];
};

export class StatusManager {
    client: Vimcord;
    logger: Logger;
    emitter: EventEmitter<StatusManagerEvents> = new EventEmitter();

    lastActivity: ClientActivity | null = null;
    lastActivityIndex: number = 0;
    private task: Loop | null = null;

    constructor(client: Vimcord) {
        this.client = client;

        // Define custom logger instance
        this.logger = new Logger({ prefixEmoji: "💬", prefix: `StatusManager (i${this.client.index})` });

        this.emitter.on("changed", activity => {
            if (this.client.config.app.verbose) {
                this.logger.debug(`Status changed to '${activity.name}'`);
            }
        });

        this.emitter.on("cleared", () => {
            if (this.client.config.app.verbose) {
                this.logger.debug("Status cleared");
            }
        });
    }

    private clearData() {
        this.task?.stop();
        this.task = null;
        this.lastActivity = null;
        this.lastActivityIndex = 0;
        return this;
    }

    private async getReadyClient() {
        const client = await this.client.whenReady();
        if (!client.user) throw new Error("Cannot manage the client's activity when its user is not hydrated");
        return client;
    }

    private async formatActivityName(name: string) {
        name = name
            .replace("$USER_COUNT", formatThousands(this.client.users.cache.size))
            .replace("$GUILD_COUNT", formatThousands(this.client.guilds.cache.size))
            .replace(
                "$INVITE",
                this.client.config.staff.guild.inviteUrl
                    ? this.client.config.staff.guild.inviteUrl
                    : "<STAFF_INVITE_URL_NOT_SET>"
            );

        // Staff guild context
        if (name.includes("$STAFF_GUILD_MEMBER_COUNT")) {
            await fetchGuild(this.client as Vimcord<true>, this.client.config.staff.guild.id)
                .then(guild => {
                    if (!guild) return (name = name.replace("$STAFF_GUILD_MEMBER_COUNT", "<STAFF_GUILD_NOT_FOUND>"));

                    // Guild member count
                    name = name.replace("$STAFF_GUILD_MEMBER_COUNT", formatThousands(guild.members.cache.size));
                })
                .catch(err => this.logger.error("Failed to fetch the staff guild", err));
        }

        return name;
    }

    private async setActivity(activity: ClientActivity) {
        const client = await this.getReadyClient();

        // Format the activity's name
        activity.name = await this.formatActivityName(activity.name);

        // Set the status
        client.user.setStatus(activity.status);
        // Set the activity
        client.user.setActivity({ name: activity.name, type: activity.type, url: activity.streamUrl });

        this.emitter.emit("changed", activity);
    }

    private async statusRotationTask(clientStatus: ClientStatus) {
        let activity: ClientActivity;

        // Randomly pick a new activity that wasn't our last one
        if (clientStatus.randomize && Array.isArray(clientStatus.activity)) {
            activity = $.rnd.choice(clientStatus.activity, { not: this.lastActivity });

            // Cache the current activity to compare to the next one
            this.lastActivity = activity;
        } else {
            const activityIndex = (this.lastActivityIndex + 1) % (clientStatus.activity as ClientActivity[]).length;
            this.lastActivityIndex = activityIndex;

            // Pick the next activity in the list
            activity = (clientStatus.activity as ClientActivity[])[activityIndex]!;
        }

        // Set the client's activity to the new activity
        await this.setActivity(activity);
        this.emitter.emit("rotation", activity);
    }

    private async scheduleStatusRotation(clientStatus: ClientStatus) {
        if (!clientStatus.interval) throw new Error("Cannot create client activity interval without interval time");

        this.task?.stop();
        this.task = null;

        // Create a new activity interval
        this.task = new $.Loop(() => this.statusRotationTask(clientStatus), $.math.ms(clientStatus.interval), true);

        // Start the rotation task
        this.start();
    }

    start(): this {
        if (this.task) {
            this.task.start();
            this.emitter.emit("started", this.task);
        }
        return this;
    }

    pause(): this {
        if (this.task) {
            this.task.stop();
            this.emitter.emit("paused", this.task);
        }
        return this;
    }

    async set(status: PartialDeep<VimcordClientStatus>): Promise<this> {
        const statusConfig = createVimcordStatusConfig(status);

        let clientStatus: ClientStatus;

        if (this.client.config.app.devMode) {
            clientStatus = statusConfig.development;
        } else {
            clientStatus = statusConfig.production;
        }

        // Just set the status without creating an interval
        if (!clientStatus.interval) {
            await this.setActivity(Array.isArray(clientStatus.activity) ? clientStatus.activity[0]! : clientStatus.activity);
        } else {
            // Create a new activity interval
            await this.scheduleStatusRotation(clientStatus);
        }

        return this;
    }

    async destroy(): Promise<this> {
        if (this.task) {
            this.task.stop();
            this.task = null;
            this.emitter.emit("destroyed");

            // Clear the status and data
            await this.clear();
        }
        return this;
    }

    async clear(): Promise<this> {
        const client = await this.getReadyClient();
        this.clearData();
        client.user.setActivity({ name: "" });
        this.emitter.emit("cleared");
        return this;
    }
}
