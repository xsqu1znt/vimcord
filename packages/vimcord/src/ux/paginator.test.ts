import type { DynaSendOptions } from "./dynaSend.js";

import EventEmitter from "node:events";
import { Readable } from "node:stream";
import {
    ActionRowBuilder,
    BaseInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    Collection,
    ComponentType,
    ContainerBuilder,
    EmbedBuilder,
    Message,
    MessageComponentInteraction,
    MessagePayload
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetterModal } from "./betterModal.js";
import { dynaSend } from "./dynaSend.js";
import { Paginator } from "./paginator.js";
import { getGlobalUxConfig } from "./uxConfig.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

vi.mock("./interactionRouter.js", () => ({
    createRoutedMessageCollector: (
        message: { createMessageComponentCollector(options: unknown): unknown },
        options: unknown
    ) => message.createMessageComponentCollector(options)
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createMessage(components: { toJSON(): unknown }[] = []) {
    const collector = Object.assign(new EventEmitter(), {
        stop: vi.fn(),
        collected: new Collection(),
        users: new Collection()
    });
    const message = {
        editable: true,
        deletable: true,
        components,
        mentions: { repliedUser: { id: "user" } },
        edit: vi.fn(),
        delete: vi.fn(),
        createMessageComponentCollector: vi.fn(() => collector)
    };
    return { message, collector };
}

function createInteraction(customId: string, values: string[] = []) {
    return {
        customId,
        values,
        user: { id: "user" },
        replied: false,
        deferred: false,
        deferUpdate: vi.fn(async function (this: { deferred: boolean }) {
            this.deferred = true;
        }),
        reply: vi.fn(async function (this: { replied: boolean }) {
            this.replied = true;
        }),
        update: vi.fn(async function (
            this: { replied: boolean },
            _options: unknown
        ): Promise<{ resource: { message: unknown } }> {
            this.replied = true;
            return { resource: { message: null } };
        }),
        followUp: vi.fn().mockResolvedValue(undefined),
        isMessageComponent: () => customId !== "modal",
        isStringSelectMenu: () => customId === "paginator:chapter"
    };
}

async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

async function sendPaginator(paginator: Paginator) {
    const { message, collector } = createMessage();
    vi.mocked(dynaSend).mockResolvedValue(message as never);
    await paginator.send({} as never);
    return { message, collector };
}

function createDashboardRows() {
    return [
        ["Import", "Customs", "Replace", "Options"],
        ["Preview", "Delete Draft"]
    ].map(ids =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            ids.map(id => new ButtonBuilder().setCustomId(id).setLabel(id).setStyle(ButtonStyle.Secondary))
        )
    );
}

function getRowIds(components: DynaSendOptions["components"] = []) {
    return components.map(row => {
        const data = row.toJSON();
        return data.type === ComponentType.ActionRow
            ? data.components.map(c => ("custom_id" in c ? c.custom_id : null))
            : [];
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(dynaSend).mockReset();
    getGlobalUxConfig().paginator.notAParticipantMessage = "You are not allowed to use this.";
    const messages = getGlobalUxConfig().paginator.messages;
    messages.loadFailed = null;
    messages.expired = null;
    messages.chapterChanged = null;
});

describe("Paginator chapter select ordering", () => {
    it.each([undefined, "afterComponents", "beforeComponents"] as const)(
        "preserves supplied rows and keeps navigation last with position %s",
        async chapterSelectPosition => {
            const buttonRows = createDashboardRows();
            const p = new Paginator({ timeout: 1000, chapterSelectPosition })
                .addChapter({ pages: ["Overview", "More"], label: "Overview", value: "overview" })
                .addChapter({ pages: ["Draft"], label: "Draft", value: "draft" });
            const { message } = createMessage();
            vi.mocked(dynaSend).mockResolvedValue(message as never);
            await p.send({} as never, { components: buttonRows, allowedMentions: { repliedUser: false } });

            const data = vi.mocked(dynaSend).mock.lastCall![1];
            const supplied = [
                ["Import", "Customs", "Replace", "Options"],
                ["Preview", "Delete Draft"]
            ];
            const chapter = ["paginator:chapter"];
            const nav = ["paginator:back", "paginator:next"];
            expect(getRowIds(data.components)).toEqual(
                chapterSelectPosition === "beforeComponents" ? [chapter, ...supplied, nav] : [...supplied, chapter, nav]
            );
            const offset = chapterSelectPosition === "beforeComponents" ? 1 : 0;
            expect(data.components?.[offset]).toBe(buttonRows[0]);
            expect(data.components?.[offset + 1]).toBe(buttonRows[1]);
            expect(buttonRows).toHaveLength(2);
            expect(data.allowedMentions).toEqual({ repliedUser: false });
        }
    );

    it("keeps a single chapter's navigation below supplied rows", async () => {
        const p = new Paginator({ timeout: 1000, pages: ["A", "B"], chapterSelectPosition: "beforeComponents" });
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await p.send({} as never, { components: createDashboardRows() });

        expect(getRowIds(vi.mocked(dynaSend).mock.lastCall![1].components)).toEqual([
            ["Import", "Customs", "Replace", "Options"],
            ["Preview", "Delete Draft"],
            ["paginator:back", "paginator:next"]
        ]);
    });

    it.each(["disable", "clear"] as const)(
        "retains the layout across updates and applies %s to the latest rows on timeout",
        async onResolve => {
            const buttonRows = createDashboardRows();
            const p = new Paginator({ timeout: 1000, chapterSelectPosition: "beforeComponents", onResolve })
                .addChapter({ pages: ["Overview"], label: "Overview", value: "overview" })
                .addChapter({ pages: ["Draft0", "Draft1"], label: "Draft", value: "draft" });
            const { message, collector } = createMessage();
            vi.mocked(dynaSend).mockImplementation(async (_handler, data) => {
                message.components = data.components ?? [];
                return message as never;
            });
            await p.send({} as never, { components: buttonRows, allowedMentions: { repliedUser: false } });
            const supplied = [
                ["Import", "Customs", "Replace", "Options"],
                ["Preview", "Delete Draft"]
            ];
            const chapter = ["paginator:chapter"];
            const nav = ["paginator:back", "paginator:next"];
            expect(getRowIds(vi.mocked(dynaSend).mock.lastCall![1].components)).toEqual([chapter, ...supplied]);

            buttonRows[0]!.components[0]!.setLabel("Import updated");
            await p.refresh();
            const refreshed = vi.mocked(dynaSend).mock.lastCall![1];
            expect(getRowIds(refreshed.components)).toEqual([chapter, ...supplied]);
            expect(refreshed.components?.[1]?.toJSON()).toMatchObject({
                components: [{ label: "Import updated" }, {}, {}, {}]
            });

            const select = createInteraction("paginator:chapter", ["draft"]);
            select.update.mockImplementation(async options => {
                message.components = (options as DynaSendOptions).components ?? [];
                return { resource: { message } };
            });
            collector.emit("collect", select);
            await settle();
            const selected = select.update.mock.lastCall![0] as DynaSendOptions;
            expect(selected.content).toBe("Draft0");
            expect(getRowIds(selected.components)).toEqual([chapter, ...supplied, nav]);
            expect(selected.components?.[0]?.toJSON()).toMatchObject({
                components: [
                    {
                        options: [
                            { value: "overview", default: false },
                            { value: "draft", default: true }
                        ]
                    }
                ]
            });

            const next = createInteraction("paginator:next");
            next.update.mockImplementation(async options => {
                message.components = (options as DynaSendOptions).components ?? [];
                return { resource: { message } };
            });
            collector.emit("collect", next);
            await settle();
            const navigated = next.update.mock.lastCall![0] as DynaSendOptions;
            expect(navigated.content).toBe("Draft1");
            expect(getRowIds(navigated.components)).toEqual([chapter, ...supplied, nav]);
            expect(navigated.allowedMentions).toEqual({ repliedUser: false });

            await p.replaceChapters([{ value: "draft", label: "Draft", pages: ["Updated0", "Updated1"] }]);
            const single = vi.mocked(dynaSend).mock.lastCall![1];
            expect(single.content).toBe("Updated1");
            expect(getRowIds(single.components)).toEqual([...supplied, nav]);

            await p.replaceChapters([
                { value: "draft", label: "Draft", pages: ["Final0", "Final1"] },
                { value: "overview", label: "Overview", pages: ["New overview"] }
            ]);
            const replaced = vi.mocked(dynaSend).mock.lastCall![1];
            expect(replaced.content).toBe("Final1");
            expect(getRowIds(replaced.components)).toEqual([chapter, ...supplied, nav]);
            expect(replaced.components?.[0]?.toJSON()).toMatchObject({
                components: [
                    {
                        options: [
                            { value: "draft", default: true },
                            { value: "overview", default: false }
                        ]
                    }
                ]
            });

            collector.emit("end", [], "time");
            await settle();
            const cleanup = message.edit.mock.lastCall![0];
            expect(cleanup.allowedMentions).toEqual({ repliedUser: false });
            if (onResolve === "clear") {
                expect(cleanup.components).toEqual([]);
                return;
            }
            const finalRows = replaced.components!.map(row => row.toJSON());
            expect(cleanup.components).toEqual(
                finalRows.map(row => ({
                    ...row,
                    components:
                        row.type === ComponentType.ActionRow ? row.components.map(c => ({ ...c, disabled: true })) : []
                }))
            );
            expect(buttonRows.flatMap(row => row.components).every(c => !c.data.disabled)).toBe(true);
        }
    );
});

describe("Paginator collection and navigation", () => {
    it("passes the stop reason and combines the final payload with cleanup", async () => {
        const onResolve = vi.fn(() => ({ action: "clear" as const, content: "Expired" }));
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onResolve });
        const { message, collector } = await sendPaginator(paginator);
        message.edit.mockResolvedValue(message);
        collector.emit("end", [], "manual");
        await settle();
        expect(onResolve).toHaveBeenCalledWith({ message, reason: "manual" });
        expect(message.edit).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "Expired" }));
    });

    it.each(["disable", "clear"] as const)("preserves reply mention settings when %s on timeout", async onResolve => {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("next").setLabel("Next").setStyle(ButtonStyle.Secondary)
        );
        const { message, collector } = createMessage([row]);
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onResolve });

        await paginator.send({} as never, { allowedMentions: { repliedUser: false } });
        collector.emit("end", [], "time");
        await settle();

        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { repliedUser: false } }));
    });

    it("still cleans up and emits postTimeout when an in-flight refresh rejects", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onResolve: "delete" });
        const { message, collector } = await sendPaginator(paginator);
        const pending = deferred<never>();
        vi.mocked(dynaSend).mockReturnValueOnce(pending.promise);
        const postTimeout = vi.fn();
        paginator.on("postTimeout", postTimeout);
        const failure = new Error("Edit failed");
        const refresh = expect(paginator.refresh()).rejects.toThrow(failure);
        collector.emit("end", [], "time");
        await settle();
        pending.reject(failure);
        await refresh;
        await settle();

        expect(message.delete).toHaveBeenCalledOnce();
        expect(postTimeout).toHaveBeenCalledOnce();
    });

    it.each(["navigation", "reload", "refresh", "placeholder"] as const)(
        "cleans up the latest message snapshot when timeout interrupts a %s edit",
        async operation => {
            const original = new ContainerBuilder().addTextDisplayComponents(t => t.setContent("Original"));
            const latest = new ContainerBuilder().addTextDisplayComponents(t => t.setContent("Latest"));
            let page = original;
            const paginator = new Paginator({
                timeout: 1000,
                onResolve: "clear",
                onLoading: operation === "placeholder" ? () => latest : undefined
            }).addChapter({ label: "Data", pageCount: 2, page: () => page });
            const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("next").setLabel("Next").setStyle(ButtonStyle.Secondary)
            );
            const { message, collector } = createMessage([new ContainerBuilder(original.toJSON()), controls]);
            vi.mocked(dynaSend).mockResolvedValue(message as never);
            await paginator.send({} as never);
            page = latest;
            if (operation === "refresh") original.spliceComponents(0, 1, latest.components[0]!);

            const gate = deferred<void>();
            const started = deferred<void>();
            const updated = createMessage([latest, controls]);
            vi.mocked(dynaSend).mockImplementationOnce(async () => {
                started.resolve();
                await gate.promise;
                return updated.message as never;
            });
            const paginate = vi.fn();
            const postTimeout = vi.fn();
            paginator.on("paginate", paginate).on("postTimeout", postTimeout);
            const pending =
                operation === "reload"
                    ? paginator.reloadChapter()
                    : operation === "refresh"
                      ? paginator.refresh()
                      : paginator.setPage(0, 1);
            await started.promise;
            collector.emit("end", [], "time");
            await settle();
            gate.resolve();
            await pending;
            await settle();

            expect(message.edit).not.toHaveBeenCalled();
            expect(updated.message.edit).toHaveBeenCalledWith({ components: [latest.toJSON()] });
            expect(postTimeout).toHaveBeenCalledWith(updated.message);
            expect(paginate).not.toHaveBeenCalled();
            expect(vi.mocked(dynaSend)).toHaveBeenCalledTimes(2);
        }
    );

    it("collects custom controls and global callbacks on a single page without navigation", async () => {
        const button = new ButtonBuilder().setCustomId("next").setLabel("Custom").setStyle(ButtonStyle.Secondary);
        const paginator = new Paginator({ pages: ["Only"], timeout: 1000 }).insertButtonAt(0, button);
        const component = vi.fn();
        const collect = vi.fn();
        paginator.onComponent("next", component).on("collect", collect);

        const { message, collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("next"));
        await settle();

        expect(message.createMessageComponentCollector).toHaveBeenCalledOnce();
        expect(component).toHaveBeenCalledOnce();
        expect(collect).toHaveBeenCalledOnce();
    });

    it("emits one paginate event after each successful action and none for refresh", async () => {
        const paginator = new Paginator({ nav: "long", jump: true, timeout: 1000 });
        paginator.addChapter({ pages: ["0", "1", "2", "3", "4"], label: "A" });
        paginator.addChapter({ pages: ["B"], label: "B" });
        const events: string[] = [];
        paginator.on("paginate", e =>
            events.push(
                `${e.action}:${e.previous.chapter}.${e.previous.nested}>${e.destination.chapter}.${e.destination.nested}`
            )
        );
        const { collector } = await sendPaginator(paginator);

        for (const id of ["next", "back", "last", "first"]) {
            const i = createInteraction(`paginator:${id}`);
            collector.emit("collect", i);
            await settle();
            expect(i.deferUpdate).not.toHaveBeenCalled();
            expect(i.update).toHaveBeenCalledOnce();
        }

        vi.spyOn(BetterModal.prototype, "showAndAwait").mockResolvedValue({
            interaction: createInteraction("modal") as never,
            fields: { "paginator:jump:page": "4" },
            reply: vi.fn(),
            followUp: vi.fn()
        } as never);
        collector.emit("collect", createInteraction("paginator:jump"));
        await settle();
        collector.emit("collect", createInteraction("paginator:chapter", [paginator.chapters[1]!.id]));
        await settle();
        await paginator.setPage(0, 4);
        const noop = createInteraction("paginator:last");
        collector.emit("collect", noop);
        await settle();
        expect(noop.deferUpdate).toHaveBeenCalledOnce();
        expect(noop.update).not.toHaveBeenCalled();
        await paginator.refresh();

        expect(events).toEqual([
            "next:0.0>0.1",
            "back:0.1>0.0",
            "last:0.0>0.4",
            "first:0.4>0.0",
            "jump:0.0>0.3",
            "chapter:0.3>1.0",
            "set:1.0>0.4"
        ]);
        expect(vi.mocked(dynaSend).mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({ method: "edit" }));
    });

    it("renders navigation and chapter selection for the destination chapter", async () => {
        const paginator = new Paginator({ pages: ["Only"], timeout: 1000 }).addChapter({ pages: ["A", "B"], label: "Many" });
        const { collector } = await sendPaginator(paginator);
        const interaction = createInteraction("paginator:chapter", [paginator.chapters[1]!.id]);
        collector.emit("collect", interaction);
        await settle();

        const components = interaction.update.mock.lastCall![0] as DynaSendOptions;
        expect(components.components![0]!.toJSON()).toMatchObject({
            components: [{ options: [{}, { default: true }] }]
        });
        expect(getRowIds(components.components).flat()).toContain("paginator:next");
    });

    it("forces withResponse for fresh interaction sends", async () => {
        const paginator = new Paginator({ pages: ["Only"], timeout: 1000 });
        await sendPaginator(paginator);
        expect(vi.mocked(dynaSend).mock.calls[0]![1].withResponse).toBe(true);
    });

    it("acknowledges competing clicks while only the first slow load runs", async () => {
        const slow = deferred<string>();
        const loader = vi.fn((page: number) => (page === 0 ? Promise.resolve("0") : slow.promise));
        const paginator = new Paginator({ timeout: 1000 }).addChapter({ label: "Pages", pageCount: 3, page: loader });
        const { collector } = await sendPaginator(paginator);
        const first = createInteraction("paginator:next");
        const second = createInteraction("paginator:back");

        collector.emit("collect", first);
        await settle();
        collector.emit("collect", second);
        await settle();
        slow.resolve("1");
        await settle();

        expect(loader).toHaveBeenCalledTimes(2);
        expect(loader.mock.calls.map(c => c[0])).toEqual([0, 1]);
        expect(first.deferUpdate).toHaveBeenCalledOnce();
        expect(second.deferUpdate).toHaveBeenCalledOnce();
    });

    it("moves to the new last page when a page loader shrinks its chapter", async () => {
        const loader = vi.fn((page: number, { setPageCount }) => {
            if (page > 0) setPageCount(2);
            return String(page);
        });
        const paginator = new Paginator({ timeout: 1000 }).addChapter({ label: "Pages", pageCount: 3, page: loader });
        const paginate = vi.fn();
        paginator.on("paginate", paginate);
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:last"));
        await settle();

        expect(loader.mock.calls.map(c => c[0])).toEqual([0, 2, 1]);
        expect(paginate.mock.calls[0]![0]).toMatchObject({ destination: { chapter: 0, nested: 1 }, page: "1" });
    });

    it("serializes concurrent programmatic chapter loads", async () => {
        const slow = deferred<string[]>();
        const loader = vi.fn(() => slow.promise);
        const paginator = new Paginator({ pages: ["Current"], timeout: 1000 }).addChapter({ label: "Lazy", load: loader });
        await sendPaginator(paginator);

        const first = paginator.setPage(1, 0);
        const second = paginator.setPage(1, 0);
        slow.resolve(["Loaded"]);
        await Promise.all([first, second]);

        expect(loader).toHaveBeenCalledOnce();
    });

    it("does not refresh after collection ends", async () => {
        const paginator = new Paginator({ pages: ["Current"], timeout: 1000 });
        const { collector } = await sendPaginator(paginator);
        collector.emit("end", [], "time");
        await settle();
        await paginator.refresh();
        expect(vi.mocked(dynaSend)).toHaveBeenCalledOnce();
    });

    it("restores the previous page after a placeholder load fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const slow = deferred<string>();
        const paginator = new Paginator({ timeout: 1000, onLoading: () => "Loading" }).addChapter({
            label: "Pages",
            pageCount: 2,
            page: page => (page === 0 ? "Current" : slow.promise)
        });
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();

        await new Promise(r => setTimeout(r, 170));
        slow.reject(new Error("load failed"));
        await settle();
        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).toEqual(["Current", "Loading", "Current"]);
    });

    it("lets timeout cleanup win over a pending load and suppresses paginate", async () => {
        const slow = deferred<string>();
        const paginator = new Paginator({ timeout: 1000, onResolve: "keep" }).addChapter({
            label: "Pages",
            pageCount: 2,
            page: page => (page === 0 ? "Current" : slow.promise)
        });
        const paginate = vi.fn();
        paginator.on("paginate", paginate);
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();
        collector.emit("end", [], "time");
        slow.resolve("Late");
        await settle();

        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).toEqual(["Current"]);
        expect(paginate).not.toHaveBeenCalled();
    });

    it("does not hold navigation while a jump modal remains unsubmitted", async () => {
        const modal = deferred<null>();
        vi.spyOn(BetterModal.prototype, "showAndAwait").mockReturnValue(modal.promise);
        const paginator = new Paginator({ pages: ["0", "1"], jump: true, timeout: 1000 });
        const paginate = vi.fn();
        paginator.on("paginate", paginate);
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:jump"));
        await settle();
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();

        expect(paginate).toHaveBeenCalledWith(expect.objectContaining({ action: "next" }));
        modal.resolve(null);
    });

    it("silently acknowledges a stale chapter jump and sends configured expiry text once", async () => {
        const firstModal = deferred<Awaited<ReturnType<BetterModal["showAndAwait"]>>>();
        vi.spyOn(BetterModal.prototype, "showAndAwait").mockReturnValue(firstModal.promise);
        const paginator = new Paginator({ pages: ["0", "1"], jump: true, timeout: 1000 }).addChapter({
            pages: ["B"],
            label: "B"
        });
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:jump"));
        await settle();
        collector.emit("collect", createInteraction("paginator:chapter", [paginator.chapters[1]!.id]));
        await settle();

        const stale = createInteraction("modal");
        firstModal.resolve({
            interaction: stale as never,
            fields: { "paginator:jump:page": "1" },
            reply: vi.fn(),
            followUp: vi.fn()
        } as never);
        await settle();
        expect(stale.deferUpdate).toHaveBeenCalledOnce();
        expect(stale.reply).not.toHaveBeenCalled();
        expect(stale.followUp).not.toHaveBeenCalled();

        getGlobalUxConfig().paginator.messages.expired = "This paginator expired.";
        const secondModal = deferred<Awaited<ReturnType<BetterModal["showAndAwait"]>>>();
        vi.mocked(BetterModal.prototype.showAndAwait).mockReturnValue(secondModal.promise);
        const expiring = new Paginator({ pages: ["0", "1"], jump: true, timeout: 1000 });
        const second = await sendPaginator(expiring);
        second.collector.emit("collect", createInteraction("paginator:jump"));
        await settle();
        second.collector.emit("end", [], "time");
        await settle();

        const expired = createInteraction("modal");
        secondModal.resolve({
            interaction: expired as never,
            fields: { "paginator:jump:page": "1" },
            reply: vi.fn(),
            followUp: vi.fn()
        } as never);
        await settle();
        expect(expired.reply).toHaveBeenCalledOnce();
        expect(expired.reply).toHaveBeenCalledWith({ content: "This paginator expired.", flags: "Ephemeral" });
        expect(expired.deferUpdate).not.toHaveBeenCalled();
    });
});

describe("Paginator loaders and API boundaries", () => {
    it("preserves the previous chapter when reloading removes the current page", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const previousPages = ["A", "B", "C"];
        const loader = vi.fn().mockResolvedValueOnce(previousPages).mockResolvedValue(["New A"]);
        const paginator = new Paginator({ timeout: 1000, onLoading: () => "Loading" }).addChapter({
            label: "Data",
            load: loader
        });
        const events = vi.fn();
        paginator.on("paginate", events);
        await sendPaginator(paginator);
        await paginator.setPage(0, 2);
        events.mockClear();
        await paginator.reloadChapter();

        const restored = vi.mocked(dynaSend).mock.calls.at(-1)![1];
        expect(restored.content).toBe("C");
        expect(restored.components).toHaveLength(1);
        expect(paginator.chapters[0]!.source).toMatchObject({ pages: previousPages });
        expect(error).toHaveBeenCalled();
        expect(events).not.toHaveBeenCalled();
        await paginator.setPage(0, 1);
        expect(vi.mocked(dynaSend).mock.calls.at(-1)![1].content).toBe("B");
        expect(events).toHaveBeenCalledWith(expect.objectContaining({ previous: { chapter: 0, nested: 2 } }));
    });

    it("does not show a loading placeholder when reloading a static chapter", async () => {
        const onLoading = vi.fn(() => "Loading");
        const paginator = new Paginator({ timeout: 1000, pages: ["Static"], onLoading });
        await sendPaginator(paginator);
        await paginator.reloadChapter();

        expect(onLoading).not.toHaveBeenCalled();
        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).not.toContain("Loading");
    });

    it("caches chapter loaders, reloads explicitly, and never caches page loaders", async () => {
        const chapterLoader = vi.fn().mockResolvedValue(["A", "B"]);
        const paginator = new Paginator({ timeout: 1000 }).addChapter({ label: "Lazy", load: chapterLoader });
        await sendPaginator(paginator);
        await paginator.setPage(0, 1);
        await paginator.setPage(0, 0);
        await paginator.refresh();
        expect(chapterLoader).toHaveBeenCalledOnce();
        await paginator.reloadChapter();
        expect(chapterLoader).toHaveBeenCalledTimes(2);

        const pageLoader = vi.fn((page: number) => String(page));
        const pages = new Paginator({ timeout: 1000 }).addChapter({ label: "Pages", pageCount: 2, page: pageLoader });
        await sendPaginator(pages);
        await pages.setPage(0, 1);
        await pages.setPage(0, 0);
        expect(pageLoader.mock.calls.map(c => c[0])).toEqual([0, 1, 0]);
    });

    it("rejects mixed static formats before send and mixed lazy results before edit", async () => {
        const mixed = new Paginator({ timeout: 1000 }).addChapter({
            pages: ["Ordinary", new ContainerBuilder()],
            label: "Mixed"
        });
        await expect(mixed.send({} as never)).rejects.toThrow("cannot mix ordinary pages");

        vi.spyOn(console, "error").mockImplementation(() => {});
        const lazy = new Paginator({ timeout: 1000 }).addChapter({
            label: "Lazy",
            pageCount: 2,
            page: page => (page === 0 ? "Ordinary" : new ContainerBuilder())
        });
        const { collector } = await sendPaginator(lazy);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();
        expect(vi.mocked(dynaSend)).toHaveBeenCalledOnce();
    });

    it("uses a Components V2 placeholder for a Components V2 page load", async () => {
        const loading = new ContainerBuilder();
        const loaded = new ContainerBuilder();
        const slow = deferred<{ containers: ContainerBuilder[] }>();
        const paginator = new Paginator({
            timeout: 1000,
            onLoading: () => ({ containers: [loading] })
        }).addChapter({
            label: "V2",
            pageCount: 2,
            page: page => (page === 0 ? { containers: [new ContainerBuilder()] } : slow.promise)
        });
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();

        await new Promise(r => setTimeout(r, 170));
        slow.resolve({ containers: [loaded] });
        await settle();
        expect(vi.mocked(dynaSend).mock.calls[1]![1].components).toContain(loading);
        expect(vi.mocked(dynaSend).mock.calls[2]![1].components).toContain(loaded);
    });

    it("keeps generated chapter IDs unique and removes custom buttons by insertion position", async () => {
        const custom = (id: string) => new ButtonBuilder().setCustomId(id).setLabel(id).setStyle(ButtonStyle.Secondary);
        const paginator = new Paginator({ pages: ["0", "1"], timeout: 1000 });
        paginator.addChapter({ pages: ["B"], label: "B" });
        const removedId = paginator.chapters[1]!.id;
        paginator.spliceChapters(1, 1).addChapter({ pages: ["C"], label: "C" });
        expect(paginator.chapters[1]!.id).not.toBe(removedId);

        paginator.insertButtonAt(0, custom("zero")).insertButtonAt(2, custom("two")).removeButtonAt(0);
        await sendPaginator(paginator);
        const components = vi.mocked(dynaSend).mock.calls[0]![1].components ?? [];
        const ids = components.flatMap(row =>
            "components" in row ? row.components.map(c => (c.toJSON() as { custom_id?: string }).custom_id) : []
        );
        expect(ids).toContain("two");
        expect(ids).not.toContain("zero");
    });
});

describe("Paginator acknowledgement and snapshots", () => {
    it.each(["static", "cached chapter", "chapter select", "cached chapter select", "jump submission"] as const)(
        "waits for acknowledgement before building the destination for %s navigation",
        async navigation => {
            const page = {
                get content() {
                    return "Destination";
                }
            };
            const loader = vi.fn(() => ["A", page]);
            const p = new Paginator({ timeout: 1000, jump: true });
            if (navigation === "cached chapter") p.addChapter({ label: "Cached", load: loader });
            else p.addChapter({ pages: ["A", page], label: "A" });
            if (navigation === "chapter select") p.addChapter({ pages: [page], label: "B", value: "b" });
            if (navigation === "cached chapter select") {
                loader.mockImplementation(() => [page]);
                p.addChapter({ label: "Cached", value: "b", load: loader });
            }
            const { collector } = await sendPaginator(p);
            if (navigation === "cached chapter select") {
                await p.setPage(1, 0);
                await p.setPage(0, 0);
            }
            vi.mocked(dynaSend).mockClear();
            const gate = deferred<void>();
            const i = createInteraction(navigation.includes("chapter select") ? "paginator:chapter" : "paginator:next", [
                "b"
            ]);
            i.deferUpdate.mockImplementation(async () => {
                await gate.promise;
                i.deferred = true;
            });
            const readPage = vi.spyOn(page, "content", "get").mockImplementation(() => {
                expect(i.deferred).toBe(true);
                return "Destination";
            });
            const showModal = vi.fn(async () => {});
            const opening = Object.assign(createInteraction("paginator:jump"), { showModal });
            if (navigation === "jump submission") {
                vi.spyOn(BetterModal.prototype, "awaitSubmit").mockResolvedValue({
                    interaction: i as never,
                    fields: { "paginator:jump:page": "2" },
                    reply: vi.fn(),
                    followUp: vi.fn()
                });
            }
            collector.emit("collect", navigation === "jump submission" ? opening : i);
            await settle();
            expect(i.deferUpdate).toHaveBeenCalledOnce();
            expect(readPage).not.toHaveBeenCalled();
            expect(dynaSend).not.toHaveBeenCalled();
            gate.resolve();
            await settle();

            expect(readPage).toHaveBeenCalled();
            expect(i.update).not.toHaveBeenCalled();
            expect(vi.mocked(dynaSend).mock.lastCall![1]).toMatchObject({
                content: "Destination",
                method: "edit"
            });
            if (navigation.startsWith("cached chapter")) expect(loader).toHaveBeenCalledOnce();
            if (navigation === "jump submission") {
                expect(showModal).toHaveBeenCalledOnce();
                expect(opening.deferUpdate).not.toHaveBeenCalled();
            }
        }
    );

    it("acknowledges before Discord.js prepares an attachment taking longer than the initial-response deadline", async () => {
        const client = new Client({ intents: [] });
        const i = createInteraction("paginator:next");
        Object.setPrototypeOf(i, MessageComponentInteraction.prototype);
        Object.defineProperty(i, "client", { value: client });
        const startedAt = Date.now();
        const acknowledgements: number[] = [];
        const post = vi.spyOn(client.rest, "post").mockImplementation(async () => {
            const elapsed = Date.now() - startedAt;
            acknowledgements.push(elapsed);
            if (elapsed >= 3000) throw new Error("Unknown interaction: initial response exceeded 3 seconds");
            return {};
        });
        i.deferUpdate.mockImplementation(async () => {
            await MessageComponentInteraction.prototype.deferUpdate.call(i as never);
        });
        i.update.mockImplementation(async options => {
            await MessageComponentInteraction.prototype.update.call(i as never, options as never);
            return { resource: { message: null } };
        });
        const file = Readable.from(
            (async function* () {
                await new Promise(r => setTimeout(r, 3200));
                yield Buffer.from("attachment contents");
            })()
        );
        const p = new Paginator({ pages: ["A", { files: [{ attachment: file, name: "slow.txt" }] }], timeout: 10000 });
        const finished = deferred<void>();
        const paginate = vi.fn(() => finished.resolve());
        p.on("paginate", paginate);
        const { message, collector } = await sendPaginator(p);
        const edited = vi.fn();
        vi.mocked(dynaSend).mockImplementationOnce(async (_handler, data) => {
            const payload = await MessagePayload.create(i as never, data as never)
                .resolveBody()
                .resolveFiles();
            expect(payload.files?.[0]?.data).toEqual(Buffer.from("attachment contents"));
            edited();
            return message as never;
        });
        const error = vi.spyOn(console, "error").mockImplementation(() => finished.resolve());
        try {
            collector.emit("collect", i);
            await finished.promise;
            await settle();
            expect(acknowledgements).toHaveLength(1);
            expect(acknowledgements[0]).toBeLessThan(3000);
            expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: { type: 6 } }));
            expect(edited).toHaveBeenCalledOnce();
            expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3200);
            expect(paginate).toHaveBeenCalledWith(expect.objectContaining({ destination: { chapter: 0, nested: 1 } }));
            expect(error).not.toHaveBeenCalled();
        } finally {
            file.destroy();
            await client.destroy();
        }
    }, 10000);

    it("acknowledges a prepared page in one update and keeps its snapshot for timeout cleanup", async () => {
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000, onResolve: "clear" });
        const { collector } = await sendPaginator(p);
        const latest = createMessage([new ActionRowBuilder<ButtonBuilder>()]).message;
        const i = createInteraction("paginator:next");
        i.update.mockResolvedValueOnce({ resource: { message: latest } });
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ content: "B", withResponse: true }));
        expect(dynaSend).toHaveBeenCalledTimes(1);
        collector.emit("end", [], "time");
        await settle();
        expect(latest.edit).toHaveBeenCalledWith({ components: [] });
    });

    it.each([
        new EmbedBuilder().setTitle("Next"),
        new ContainerBuilder().addTextDisplayComponents(t => t.setContent("Next"))
    ])("updates a prepared builder page without a separate acknowledgement: %s", async page => {
        const p = new Paginator({ pages: [page, page], timeout: 1000 });
        const paginate = vi.fn();
        p.on("paginate", paginate);
        const { collector } = await sendPaginator(p);
        const i = createInteraction("paginator:next");
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(i.update).toHaveBeenCalledOnce();
        expect(dynaSend).toHaveBeenCalledTimes(1);
        expect(paginate).toHaveBeenCalledWith(expect.objectContaining({ destination: { chapter: 0, nested: 1 } }));
    });

    it("defers before resolving shared send-option files even for text pages", async () => {
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000 });
        const { message, collector } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await p.send({} as never, { files: [{ attachment: Buffer.from("file"), name: "test.txt" }] });
        const i = createInteraction("paginator:next");
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        expect(i.update).not.toHaveBeenCalled();
        expect(dynaSend).toHaveBeenCalledTimes(2);
    });

    it("acknowledges competing clicks while a prepared-page update is pending", async () => {
        const p = new Paginator({ pages: ["A", "B", "C"], timeout: 1000 });
        const paginate = vi.fn();
        p.on("paginate", paginate);
        const { collector } = await sendPaginator(p);
        const gate = deferred<{ resource: { message: null } }>();
        const first = createInteraction("paginator:next");
        first.update.mockReturnValueOnce(gate.promise);
        collector.emit("collect", first);
        await settle();
        const second = createInteraction("paginator:next");
        collector.emit("collect", second);
        await settle();
        expect(first.update).toHaveBeenCalledOnce();
        expect(second.deferUpdate).toHaveBeenCalledOnce();
        expect(second.update).not.toHaveBeenCalled();
        gate.resolve({ resource: { message: null } });
        await settle();
        expect(paginate).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ destination: { chapter: 0, nested: 1 } })
        );
    });

    it("keeps the old page and acknowledges an update failure", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000 });
        const paginate = vi.fn();
        p.on("paginate", paginate);
        const { collector } = await sendPaginator(p);
        const i = createInteraction("paginator:next");
        i.update.mockRejectedValueOnce(new Error("Network failure"));
        collector.emit("collect", i);
        await settle();
        expect(paginate).not.toHaveBeenCalled();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        await p.refresh();
        expect(vi.mocked(dynaSend).mock.lastCall![1].content).toBe("A");
    });

    it("defers before an asynchronous collect callback and edits only after it completes", async () => {
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000 });
        const gate = deferred<void>();
        const i = createInteraction("paginator:next");
        p.on("collect", async () => {
            expect(i.deferred).toBe(true);
            await gate.promise;
        });
        const { collector } = await sendPaginator(p);
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        expect(dynaSend).toHaveBeenCalledTimes(1);
        gate.resolve();
        await settle();
        expect(i.update).not.toHaveBeenCalled();
        expect(dynaSend).toHaveBeenCalledTimes(2);
    });

    it("defers lazy loads immediately but skips loading edits for a fast load", async () => {
        const loading = vi.fn(() => "Loading");
        const i = createInteraction("paginator:next");
        const p = new Paginator({ timeout: 1000, onLoading: loading }).addChapter({
            label: "Pages",
            pageCount: 2,
            page: n => {
                if (n === 1) expect(i.deferred).toBe(true);
                return Promise.resolve(String(n));
            }
        });
        const { collector } = await sendPaginator(p);
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        expect(loading).not.toHaveBeenCalled();
        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).toEqual(["0", "1"]);
    });

    it("removes creation-only flags when navigating an ephemeral message through its sending webhook", async () => {
        const { message, collector } = createMessage();
        Object.assign(message, { id: "ephemeral", editable: false });
        const editMessage = vi.fn().mockResolvedValue(message);
        const handler = Object.assign(Object.create(BaseInteraction.prototype), {
            user: { id: "user" },
            webhook: { editMessage }
        });
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000 });
        await p.send(handler, { flags: ["Ephemeral", "SuppressNotifications", "SuppressEmbeds"] });
        const i = createInteraction("paginator:next");
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ content: "B", flags: 4, withResponse: true }));
        expect(editMessage).not.toHaveBeenCalled();
        expect(message.edit).not.toHaveBeenCalled();
    });
});

describe("Paginator chapter replacement", () => {
    it("preserves a chapter by value across reordering and clamps a shortened page list", async () => {
        const p = new Paginator({ timeout: 1000 })
            .addChapter({ pages: ["Overview"], label: "Overview", value: "overview" })
            .addChapter({ pages: ["A0", "A1", "A2"], label: "A", value: "a" });
        await sendPaginator(p);
        await p.setPage(1, 2);
        await p.replaceChapters([
            { value: "a", label: "A", pages: ["New0", "New1"] },
            { value: "overview", label: "Overview", pages: ["New overview"] }
        ]);
        expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("New1");
        await p.replaceChapters([{ value: "overview", label: "Overview", pages: ["Empty draft"] }]);
        expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("Empty draft");
    });

    it("re-renders the same position when no chapter values are supplied", async () => {
        const p = new Paginator({ timeout: 1000 })
            .addChapter({ pages: ["A"], label: "A" })
            .addChapter({ pages: ["B0", "B1"], label: "B" });
        await sendPaginator(p);
        await p.setPage(1, 1);
        await p.replaceChapters([
            { label: "A", pages: ["A"] },
            { label: "B", pages: ["New0", "New1"] }
        ]);
        expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("New1");
    });

    it("prepares chapters before send and rejects invalid replacements without removing existing chapters", async () => {
        const p = new Paginator({ timeout: 1000 });
        await p.replaceChapters([{ value: "a", label: "A", pages: ["A"] }]);
        await expect(p.replaceChapters([])).rejects.toThrow("empty list");
        await expect(p.replaceChapters([{ label: "Empty", pages: [] }])).rejects.toThrow("does not have any pages");
        await expect(
            p.replaceChapters([
                { value: "a", label: "A", pages: ["A"] },
                { value: "a", label: "B", pages: ["B"] }
            ])
        ).rejects.toThrow("already in use");
        expect(p.chapters[0]?.id).toBe("a");
        await sendPaginator(p);
        expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("A");
    });

    it("uses the sending webhook for ephemeral refresh and timeout cleanup", async () => {
        const { message, collector } = createMessage([
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId("next").setStyle(ButtonStyle.Primary).setLabel("Next")
            )
        ]);
        Object.assign(message, { id: "ephemeral", editable: false });
        const editMessage = vi.fn().mockResolvedValue(message);
        const handler = Object.assign(Object.create(BaseInteraction.prototype), {
            user: { id: "user" },
            webhook: { editMessage }
        });
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const p = new Paginator({ timeout: 1000, onResolve: "disable" }).addChapter({ pages: ["A"], label: "A" });
        await p.send(handler);
        await p.replaceChapters([{ label: "A", pages: ["Updated"] }]);
        expect(editMessage).toHaveBeenCalledWith("ephemeral", expect.objectContaining({ content: "Updated" }));
        collector.emit("end", [], "time");
        await settle();
        expect(editMessage.mock.lastCall?.[1].components[0].components[0].disabled).toBe(true);
        expect(message.edit).not.toHaveBeenCalled();
    });
});

it("waits for pending navigation before replacing its chapters", async () => {
    const slow = deferred<string>();
    const p = new Paginator({ timeout: 1000 }).addChapter({
        value: "a",
        label: "A",
        pageCount: 2,
        page: n => (n === 0 ? "A" : slow.promise)
    });
    const { collector } = await sendPaginator(p);
    collector.emit("collect", createInteraction("paginator:next"));
    await settle();
    const replacement = p.replaceChapters([{ value: "a", label: "A", pages: ["New0", "New1"] }]);
    slow.resolve("Old1");
    await replacement;
    expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("New1");
});

describe("Paginator defaults", () => {
    it("takes no options, uses the short layout, idles, and disables on end", async () => {
        const row = {
            toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "x" }] })
        };
        const p = new Paginator().addChapter({ label: "A", pages: ["0", "1"] });
        const { message, collector } = createMessage([row]);
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await p.send({} as never);
        expect(message.createMessageComponentCollector).toHaveBeenCalledWith(expect.objectContaining({ idle: 60_000 }));
        expect(getRowIds(vi.mocked(dynaSend).mock.lastCall![1].components)).toEqual([["paginator:back", "paginator:next"]]);
        message.edit.mockResolvedValue(message);
        collector.emit("end", [], "idle");
        await settle();
        expect(message.edit.mock.lastCall![0].components[0].components[0].disabled).toBe(true);
    });

    it("skips cleanup but still finishes when its message was deleted", async () => {
        const p = new Paginator({ pages: ["A"] });
        const { message, collector } = await sendPaginator(p);
        const postTimeout = vi.fn();
        p.on("postTimeout", postTimeout);
        collector.emit("end", [], "messageDelete");
        await settle();
        expect(message.edit).not.toHaveBeenCalled();
        expect(postTimeout).toHaveBeenCalledOnce();
    });

    it("keeps chapter sources out of the select options", async () => {
        const p = new Paginator()
            .addChapter({ label: "Static", value: "a", pages: ["0"] })
            .addChapter({ label: "Loaded", value: "b", load: () => ["1"] })
            .addChapter({ label: "Paged", value: "c", pageCount: 2, page: () => "2" });
        await sendPaginator(p);
        const select = vi.mocked(dynaSend).mock.lastCall![1].components![0]!.toJSON() as unknown as {
            components: { options: Record<string, unknown>[] }[];
        };
        for (const option of select.components[0]!.options) {
            for (const key of ["pages", "load", "pageCount", "page"]) expect(option).not.toHaveProperty(key);
        }
    });

    function filterFor(message: ReturnType<typeof createMessage>["message"]) {
        const [options] = message.createMessageComponentCollector.mock.lastCall as unknown as [
            { filter(i: unknown): Promise<boolean> }
        ];
        const reply = vi.fn().mockResolvedValue(undefined);
        return (id: string) => options.filter({ user: { id }, customId: "paginator:next", reply });
    }

    it("restricts to the interaction's user by default", async () => {
        const handler = Object.assign(Object.create(BaseInteraction.prototype), { user: { id: "invoker" } });
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await new Paginator({ pages: ["A", "B"] }).send(handler);
        expect(await filterFor(message)("other")).toBe(false);
        expect(await filterFor(message)("invoker")).toBe(true);
    });

    it("takes participants on send, without passing them on to Discord", async () => {
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await new Paginator({ pages: ["A", "B"] }).send({} as never, { participants: ["chosen"], content: "Hi" });
        expect(await filterFor(message)("chosen")).toBe(true);
        expect(await filterFor(message)("user")).toBe(false);
        expect(vi.mocked(dynaSend).mock.lastCall![1]).not.toHaveProperty("participants");
    });

    it("leaves navigation open with anyone", async () => {
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await new Paginator({ pages: ["A", "B"] }).send({} as never, { participants: "anyone" });
        expect(await filterFor(message)("someone")).toBe(true);
    });

    it("lets nobody navigate with an empty participants list", async () => {
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await new Paginator({ pages: ["A", "B"] }).send({} as never, { participants: [] });
        expect(await filterFor(message)("someone")).toBe(false);
        expect(await filterFor(message)("user")).toBe(false);
    });

    it("acknowledges silently when its not-a-participant message is configured off", async () => {
        getGlobalUxConfig().paginator.notAParticipantMessage = null;
        const { message } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        await new Paginator({ pages: ["A", "B"] }).send({} as never, { participants: ["chosen"] });
        const [options] = message.createMessageComponentCollector.mock.lastCall as unknown as [
            { filter(i: unknown): Promise<boolean> }
        ];
        const outsider = {
            user: { id: "other" },
            customId: "paginator:next",
            reply: vi.fn().mockResolvedValue(undefined),
            deferUpdate: vi.fn().mockResolvedValue(undefined)
        };
        expect(await options.filter(outsider)).toBe(false);
        expect(outsider.reply).not.toHaveBeenCalled();
        expect(outsider.deferUpdate).toHaveBeenCalledOnce();
    });

    describe("sending to a bot's message", () => {
        function botMessage(channelType = ChannelType.GuildText) {
            const target = Object.assign(Object.create(Message.prototype), { author: { bot: true } });
            return Object.defineProperty(target, "channel", { value: { type: channelType } }) as Message;
        }

        it("throws before loading a page, sending, or changing state", async () => {
            const { message } = createMessage();
            vi.mocked(dynaSend).mockResolvedValue(message as never);
            const loader = vi.fn(async () => "A");
            const p = new Paginator().addChapter({ label: "Lazy", pageCount: 2, page: loader });
            await expect(p.send(botMessage())).rejects.toThrow(/bot's message.*`participants`/);
            expect(loader).not.toHaveBeenCalled();
            expect(dynaSend).not.toHaveBeenCalled();
            expect(message.createMessageComponentCollector).not.toHaveBeenCalled();

            // Nothing stuck, so the same paginator can still be sent properly.
            await p.send(botMessage(), { participants: ["chosen"] });
            expect(dynaSend).toHaveBeenCalledOnce();
            expect(await filterFor(message)("chosen")).toBe(true);
        });

        it("still sends in a DM", async () => {
            const { message } = createMessage();
            vi.mocked(dynaSend).mockResolvedValue(message as never);
            await new Paginator({ pages: ["A"] }).send(botMessage(ChannelType.DM));
            expect(dynaSend).toHaveBeenCalledOnce();
        });
    });

    it("stops being active when the sent message has no trigger to read", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { message } = createMessage();
        Object.assign(message, { mentions: { repliedUser: null } });
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const p = new Paginator({ pages: ["A", "B"] });
        await expect(p.send({} as never)).rejects.toThrow(/participants/);
        expect(message.createMessageComponentCollector).not.toHaveBeenCalled();
        await expect(p.refresh()).resolves.toBe(message);
        expect(vi.mocked(dynaSend)).toHaveBeenCalledOnce();
    });
});
