import type {
    Client,
    CollectedInteraction,
    CollectedMessageInteraction,
    Interaction,
    InteractionCollectorOptions,
    Message,
    ModalSubmitInteraction
} from "discord.js";

import EventEmitter from "node:events";
import { DiscordjsError, DiscordjsErrorCodes, Events, InteractionCollector, InteractionType } from "discord.js";

interface Route {
    events: EventEmitter;
    messageId?: string;
    channelId?: string;
    guildId?: string;
    customId?: string;
}

type RouteIndex = Map<string, Set<Route>>;

const ROUTERS = new WeakMap<Client, InteractionRouter>();

function addRoute(index: RouteIndex, key: string | undefined, route: Route): void {
    if (!key) return;
    let routes = index.get(key);
    if (!routes) index.set(key, (routes = new Set()));
    routes.add(route);
}

function removeRoute(index: RouteIndex, key: string | undefined, route: Route): void {
    if (!key) return;
    const routes = index.get(key);
    routes?.delete(route);
    if (!routes?.size) index.delete(key);
}

// Discord.js retains ownership of filtering, limits, history, timers, and in-flight event semantics.
// Its client listeners are installed on a local emitter; the router forwards only indexed events.
class InteractionRouter {
    private readonly messages: RouteIndex = new Map();
    private readonly channels: RouteIndex = new Map();
    private readonly guilds: RouteIndex = new Map();
    private readonly modals: RouteIndex = new Map();
    private size = 0;
    private readonly handlers = {
        [Events.InteractionCreate]: (i: Interaction) => {
            const routes =
                i.type === InteractionType.ModalSubmit
                    ? this.modals.get(i.customId)
                    : i.type === InteractionType.MessageComponent
                      ? this.messages.get(i.message.id)
                      : undefined;
            for (const route of [...(routes ?? [])]) route.events.emit(Events.InteractionCreate, i);
        },
        [Events.MessageDelete]: (m: { id: string }) => this.forward(this.messages.get(m.id), Events.MessageDelete, m),
        [Events.MessageBulkDelete]: (messages: Map<string, unknown>) => {
            for (const id of messages.keys()) this.forward(this.messages.get(id), Events.MessageBulkDelete, messages);
        },
        [Events.ChannelDelete]: (c: { id: string; threads?: { cache: Map<string, unknown> } }) => {
            this.forward(this.channels.get(c.id), Events.ChannelDelete, c);
            for (const id of c.threads?.cache.keys() ?? []) this.forward(this.channels.get(id), Events.ChannelDelete, c);
        },
        [Events.ThreadDelete]: (c: { id: string }) => this.forward(this.channels.get(c.id), Events.ThreadDelete, c),
        [Events.GuildDelete]: (g: { id: string }) => this.forward(this.guilds.get(g.id), Events.GuildDelete, g)
    };

    constructor(private readonly client: Client) {}

    private forward(routes: Set<Route> | undefined, event: string, data: unknown): void {
        for (const route of [...(routes ?? [])]) route.events.emit(event, data);
    }

    create<I extends CollectedInteraction>(
        options: InteractionCollectorOptions<I>,
        customId?: string
    ): InteractionCollector<I> {
        const events = new EventEmitter();
        const localClient = Object.assign(events, {
            channels: this.client.channels,
            guilds: this.client.guilds,
            incrementMaxListeners: () => {},
            decrementMaxListeners: () => {}
        });
        const collector = new InteractionCollector<I>(localClient as unknown as Client<true>, options);
        const route: Route = {
            events,
            messageId: collector.messageId ?? undefined,
            channelId: collector.channelId ?? undefined,
            guildId: collector.guildId ?? undefined,
            customId
        };
        addRoute(this.messages, route.messageId, route);
        addRoute(this.channels, route.channelId, route);
        addRoute(this.guilds, route.guildId, route);
        addRoute(this.modals, route.customId, route);
        if (this.size++ === 0) {
            const maxListeners = this.client.getMaxListeners();
            if (maxListeners) this.client.setMaxListeners(maxListeners + 1);
            for (const [event, handler] of Object.entries(this.handlers)) this.client.on(event, handler);
        }
        collector.once("end", () => {
            removeRoute(this.messages, route.messageId, route);
            removeRoute(this.channels, route.channelId, route);
            removeRoute(this.guilds, route.guildId, route);
            removeRoute(this.modals, route.customId, route);
            if (--this.size === 0) {
                for (const [event, handler] of Object.entries(this.handlers)) this.client.off(event, handler);
                const maxListeners = this.client.getMaxListeners();
                if (maxListeners) this.client.setMaxListeners(maxListeners - 1);
            }
        });
        return collector;
    }
}

function getRouter(client: Client): InteractionRouter {
    let router = ROUTERS.get(client);
    if (!router) ROUTERS.set(client, (router = new InteractionRouter(client)));
    return router;
}

/** Creates a message collector routed by message ID, using the installed Discord.js lifecycle. */
export function createRoutedMessageCollector(
    message: Message,
    options: NonNullable<Parameters<Message["createMessageComponentCollector"]>[0]>
): InteractionCollector<CollectedMessageInteraction> {
    return getRouter(message.client).create({ ...options, message, interactionType: InteractionType.MessageComponent });
}

/** Waits for one modal custom ID with the same collection and timeout semantics as awaitModalSubmit. */
export function awaitRoutedModal(client: Client, customId: string, time: number): Promise<ModalSubmitInteraction> {
    const CollectorError = DiscordjsError as unknown as new (code: DiscordjsErrorCodes, ...args: string[]) => Error;
    if (typeof time !== "number") throw new CollectorError(DiscordjsErrorCodes.InvalidType, "time", "number");
    const collector = getRouter(client).create(
        {
            interactionType: InteractionType.ModalSubmit,
            time,
            max: 1,
            filter: i => i.type === InteractionType.ModalSubmit && i.customId === customId
        },
        customId
    );
    return new Promise((resolve, reject) =>
        collector.once("end", (collected, reason) => {
            const interaction = collected.first();
            if (interaction) resolve(interaction as ModalSubmitInteraction);
            else {
                reject(new CollectorError(DiscordjsErrorCodes.InteractionCollectorError, reason));
            }
        })
    );
}
