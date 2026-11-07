import type { ActivityOptions, PresenceStatusData } from "discord.js";
import type { Vimcord } from "./Vimcord.js";

export interface VimcordStatusActivity extends Omit<ActivityOptions, "name"> {
    /** Presence status to use while this activity is active. */
    status?: PresenceStatusData;
    /** Resolved each time the activity is applied. */
    name: string | ((client: Vimcord<true>) => string | Promise<string>);
}

export interface VimcordStatusProfile {
    /** Milliseconds between rotations or function-name refreshes. Omit to apply once. */
    interval?: number;
    /** Pick a random activity each rotation instead of stepping through the list. */
    randomize?: boolean;
    /** Activity or activities to apply for this profile. */
    activity: VimcordStatusActivity | VimcordStatusActivity[];
}

/** Optional environment-specific status profiles. At least one profile is required by `VimcordStatusConfig`. */
export interface VimcordEnvironmentStatusConfig {
    /** Status profile used when `client.$devMode` is false. */
    production?: VimcordStatusProfile;
    /** Status profile used when `client.$devMode` is true. */
    development?: VimcordStatusProfile;
}

/** A shared status profile or one or more environment-specific profiles. */
export type VimcordStatusConfig =
    | VimcordStatusProfile
    | (VimcordEnvironmentStatusConfig & ({ production: VimcordStatusProfile } | { development: VimcordStatusProfile }));

/** Manages Discord presence profiles and activity rotation for a Vimcord client. */
export class StatusManager {
    private currentProfile: VimcordStatusProfile | null = null;
    private lastActivity: VimcordStatusActivity | null = null;
    private lastActivityIndex = 0;
    private rotationTimer: ReturnType<typeof setInterval> | null = null;
    private version = 0;

    private readonly handleReady = (): void => {
        if (this.currentProfile) void this.applyProfile(this.currentProfile, this.version);
    };

    /** Creates a status manager attached to a Vimcord client. */
    constructor(private readonly client: Vimcord) {
        this.client.on("clientReady", this.handleReady);
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

    private isCurrent(version: number): boolean {
        return version === this.version;
    }

    private async setActivity(activity: VimcordStatusActivity, version: number): Promise<void> {
        const client = await this.getReadyClient();
        if (!client?.user || !this.isCurrent(version)) return;

        const { status = "online", shardId, name: activityName, ...activityOptions } = activity;
        let name: string;
        try {
            name = typeof activityName === "function" ? await activityName(client) : activityName;
        } catch (error) {
            this.client.logger.error("[StatusManager] Failed to resolve activity name", error as Error);
            return;
        }
        if (!client.isReady() || !client.user || !this.isCurrent(version)) return;

        client.user.setPresence({
            status,
            activities: [{ ...activityOptions, name }],
            shardId
        });
        this.lastActivity = activity;
        this.client.logger.debug(`[StatusManager] Status changed to '${name}'`);
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

    private async rotate(profile: VimcordStatusProfile, version: number): Promise<void> {
        if (!this.isCurrent(version)) return;

        const activity = this.pickNextActivity(profile);
        await this.setActivity(activity, version);
    }

    private async applyProfile(profile: VimcordStatusProfile, version: number): Promise<void> {
        if (!this.isCurrent(version)) return;

        const activities = this.getActivityList(profile);
        const firstActivity = activities[0];
        if (!firstActivity) return;

        this.pause();
        this.lastActivityIndex = 0;
        await this.setActivity(firstActivity, version);

        if (this.isCurrent(version)) this.start();
    }

    private resolveProfile(status: VimcordStatusConfig): VimcordStatusProfile | null {
        if ("activity" in status) return status;

        // Environment profiles are intentionally exact; an omitted current profile leaves the presence blank.
        return (this.client.$devMode ? status.development : status.production) ?? null;
    }

    /** Starts rotation or refreshes a single function name at the profile interval. */
    start(): this {
        if (this.rotationTimer || !this.currentProfile?.interval) return this;

        const profile = this.currentProfile;
        const version = this.version;
        const activities = this.getActivityList(profile);
        if (!activities.length || (activities.length === 1 && typeof activities[0]!.name !== "function")) return this;

        this.rotationTimer = setInterval(() => void this.rotate(profile, version), profile.interval);
        this.rotationTimer.unref?.();
        return this;
    }

    /** Pauses activity rotation without clearing the current activity. */
    pause(): this {
        if (!this.rotationTimer) return this;

        clearInterval(this.rotationTimer);
        this.rotationTimer = null;
        return this;
    }

    /** Sets a shared or current-environment profile, clearing the activity when that environment is omitted. */
    async set(status: VimcordStatusConfig): Promise<this> {
        const profile = this.resolveProfile(status);
        if (!profile) return this.clear();

        const version = ++this.version;
        this.currentProfile = profile;

        if (!this.client.isReady()) return this;

        await this.applyProfile(this.currentProfile, version);
        return this;
    }

    /** Clears the current activity and stops rotation. */
    async clear(): Promise<this> {
        this.version++;
        this.pause();
        this.currentProfile = null;
        this.lastActivity = null;
        this.lastActivityIndex = 0;

        if (this.client.isReady() && this.client.user) {
            this.client.user.setActivity();
        }

        this.client.logger.debug("[StatusManager] Status cleared");
        return this;
    }

    /** Destroys the manager and clears the current activity. */
    async destroy(): Promise<this> {
        this.client.off("clientReady", this.handleReady);
        await this.clear();
        return this;
    }
}
