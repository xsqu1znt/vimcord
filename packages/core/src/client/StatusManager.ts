import type { ActivityOptions, PresenceStatusData } from "discord.js";
import type { Vimcord } from "./Vimcord.js";

import EventEmitter from "node:events";

export interface VimcordStatusActivity extends ActivityOptions {
    /** Presence status to use while this activity is active. */
    status?: PresenceStatusData;
    /** Stream URL alias for Discord.js `url`. */
    streamUrl?: string;
}

export interface VimcordStatusProfile {
    /** Milliseconds between activity rotations. Leave blank to set one activity without rotating. */
    interval?: number;
    /** Pick a random activity each rotation instead of stepping through the list. */
    randomize?: boolean;
    /** Activity or activities to apply for this profile. */
    activity: VimcordStatusActivity | VimcordStatusActivity[];
}

export interface VimcordStatusConfig {
    /** Status profile used when `client.$devMode` is false. */
    production: VimcordStatusProfile;
    /** Status profile used when `client.$devMode` is true. */
    development: VimcordStatusProfile;
}

export interface StatusManagerEvents {
    changed: [activity: VimcordStatusActivity];
    cleared: [];
    rotation: [activity: VimcordStatusActivity];
    paused: [];
    started: [];
    destroyed: [];
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

export class StatusManager {
    /** Emits status lifecycle events. */
    readonly emitter = new EventEmitter<StatusManagerEvents>();

    private currentProfile: VimcordStatusProfile | null = null;
    private lastActivity: VimcordStatusActivity | null = null;
    private lastActivityIndex = 0;
    private rotationTimer: ReturnType<typeof setInterval> | null = null;

    private readonly handleReady = (): void => {
        if (this.currentProfile) void this.applyProfile(this.currentProfile);
    };

    constructor(private readonly client: Vimcord) {
        this.client.on("clientReady", this.handleReady);

        this.emitter.on("changed", activity => {
            this.client.logger.debugVerbose(`[StatusManager] Status changed to '${activity.name}'`);
        });

        this.emitter.on("cleared", () => {
            this.client.logger.debugVerbose("[StatusManager] Status cleared");
        });
    }

    private getActivityList(profile: VimcordStatusProfile): VimcordStatusActivity[] {
        return Array.isArray(profile.activity) ? profile.activity : [profile.activity];
    }

    private async getReadyClient(): Promise<Vimcord<true> | null> {
        const ready = await this.client.awaitReady();
        if (!ready || !this.client.isReady() || !this.client.user) {
            this.client.logger.warn("[StatusManager] Cannot manage activity before the client is ready");
            return null;
        }

        return this.client;
    }

    private async formatActivityName(name: string): Promise<string> {
        const replacements = {
            $USER_COUNT: NUMBER_FORMATTER.format(this.client.users.cache.size),
            $GUILD_COUNT: NUMBER_FORMATTER.format(this.client.guilds.cache.size),
            $INVITE: this.client.globals.staff.guild.inviteUrl ?? "<STAFF_INVITE_URL_NOT_SET>"
        };
        let formattedName = Object.entries(replacements).reduce(
            (current, [key, value]) => current.replaceAll(key, value),
            name
        );

        if (!formattedName.includes("$STAFF_GUILD_MEMBER_COUNT")) return formattedName;

        const staffGuildId = this.client.globals.staff.guild.id;
        if (!staffGuildId) return formattedName.replaceAll("$STAFF_GUILD_MEMBER_COUNT", "<STAFF_GUILD_NOT_SET>");

        try {
            const guild = await this.client.fetchGuild(staffGuildId);
            formattedName = formattedName.replaceAll(
                "$STAFF_GUILD_MEMBER_COUNT",
                guild ? NUMBER_FORMATTER.format(guild.memberCount) : "<STAFF_GUILD_NOT_FOUND>"
            );
        } catch (err) {
            this.client.logger.error("[StatusManager] Failed to fetch the staff guild", err as Error);
        }

        return formattedName;
    }

    private async setActivity(activity: VimcordStatusActivity): Promise<void> {
        const client = await this.getReadyClient();
        if (!client?.user) return;

        const { status = "online", streamUrl, ...activityOptions } = activity;
        const name = await this.formatActivityName(activity.name);

        client.user.setStatus(status);
        client.user.setActivity({ ...activityOptions, name, url: activityOptions.url ?? streamUrl });
        this.lastActivity = activity;
        this.emitter.emit("changed", activity);
    }

    private pickNextActivity(profile: VimcordStatusProfile): VimcordStatusActivity {
        const activities = this.getActivityList(profile);

        if (profile.randomize) {
            const choices = activities.filter(activity => activity !== this.lastActivity);
            return choices[Math.floor(Math.random() * choices.length)] ?? activities[0]!;
        }

        this.lastActivityIndex = (this.lastActivityIndex + 1) % activities.length;
        return activities[this.lastActivityIndex]!;
    }

    private async rotate(profile: VimcordStatusProfile): Promise<void> {
        const activity = this.pickNextActivity(profile);
        await this.setActivity(activity);
        this.emitter.emit("rotation", activity);
    }

    private async applyProfile(profile: VimcordStatusProfile): Promise<void> {
        const activities = this.getActivityList(profile);
        const firstActivity = activities[0];
        if (!firstActivity) return;

        this.pause();
        this.lastActivityIndex = 0;
        await this.setActivity(firstActivity);

        if (profile.interval && activities.length > 1) this.start();
    }

    /** Starts activity rotation if the current profile has a rotation interval. */
    start(): this {
        if (this.rotationTimer || !this.currentProfile?.interval) return this;

        const profile = this.currentProfile;
        const activities = this.getActivityList(profile);
        if (activities.length < 2) return this;

        this.rotationTimer = setInterval(() => void this.rotate(profile), profile.interval);
        this.rotationTimer.unref?.();
        this.emitter.emit("started");
        return this;
    }

    /** Pauses activity rotation without clearing the current activity. */
    pause(): this {
        if (!this.rotationTimer) return this;

        clearInterval(this.rotationTimer);
        this.rotationTimer = null;
        this.emitter.emit("paused");
        return this;
    }

    /**
     * Sets the active status config for the current dev or production mode.
     * @param status Production and development status config
     */
    async set(status: VimcordStatusConfig): Promise<this> {
        this.currentProfile = this.client.$devMode ? status.development : status.production;

        if (!this.client.isReady()) return this;

        await this.applyProfile(this.currentProfile);
        return this;
    }

    /** Clears the current activity and stops rotation. */
    async clear(): Promise<this> {
        this.pause();
        this.currentProfile = null;
        this.lastActivity = null;
        this.lastActivityIndex = 0;

        if (this.client.isReady() && this.client.user) {
            this.client.user.setActivity();
        }

        this.emitter.emit("cleared");
        return this;
    }

    /** Destroys the manager and clears the current activity. */
    async destroy(): Promise<this> {
        this.client.off("clientReady", this.handleReady);
        await this.clear();
        this.emitter.emit("destroyed");
        return this;
    }
}
