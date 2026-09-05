import EventEmitter from "node:events";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetterModal } from "./betterModal.js";
import { dynaSend, SendMethod } from "./dynaSend.js";
import { PaginationType, Paginator } from "./paginator.js";
import { ResolveAction } from "./shared.js";
import { getGlobalUxConfig } from "./uxConfig.js";

vi.mock("./dynaSend.js", async importOriginal => {
    const actual = await importOriginal<typeof import("./dynaSend.js")>();
    return { ...actual, dynaSend: vi.fn() };
});

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
    const collector = Object.assign(new EventEmitter(), { stop: vi.fn() });
    const message = {
        editable: true,
        deletable: true,
        components,
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
        followUp: vi.fn().mockResolvedValue(undefined),
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

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(dynaSend).mockReset();
    const messages = getGlobalUxConfig().paginator.messages;
    messages.loadFailed = null;
    messages.expired = null;
    messages.chapterChanged = null;
});

describe("Paginator collection and navigation", () => {
    it("still cleans up and emits postTimeout when an in-flight refresh rejects", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onTimeout: ResolveAction.DeleteMessage });
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
                onLoading: operation === "placeholder" ? () => latest : undefined
            }).addPageLoader(2, () => page, { label: "Data" });
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
        const paginator = new Paginator({ type: PaginationType.LongSkip, jump: true, skipSize: 2, timeout: 1000 });
        paginator.addChapter(["0", "1", "2", "3", "4"], { label: "A" });
        paginator.addChapter(["B"], { label: "B" });
        const events: string[] = [];
        paginator.on("paginate", e =>
            events.push(
                `${e.action}:${e.previous.chapter}.${e.previous.nested}>${e.destination.chapter}.${e.destination.nested}`
            )
        );
        const { collector } = await sendPaginator(paginator);

        for (const id of ["next", "back", "last", "first", "skip-next", "skip-back"]) {
            collector.emit("collect", createInteraction(`paginator:${id}`));
            await settle();
        }

        vi.spyOn(BetterModal.prototype, "showAndAwait").mockResolvedValue({
            interaction: createInteraction("modal") as never,
            getField: () => "4",
            reply: vi.fn(),
            followUp: vi.fn()
        });
        collector.emit("collect", createInteraction("paginator:jump"));
        await settle();
        collector.emit("collect", createInteraction("paginator:chapter", [paginator.chapters[1]!.id]));
        await settle();
        await paginator.setPage(0, 4);
        await paginator.refresh();

        expect(events).toEqual([
            "next:0.0>0.1",
            "back:0.1>0.0",
            "last:0.0>0.4",
            "first:0.4>0.0",
            "skipNext:0.0>0.2",
            "skipBack:0.2>0.0",
            "jump:0.0>0.3",
            "chapter:0.3>1.0",
            "set:1.0>0.4"
        ]);
        expect(vi.mocked(dynaSend).mock.calls.at(-1)?.[1]).toEqual(
            expect.objectContaining({ sendMethod: SendMethod.MessageEdit })
        );
    });

    it("renders navigation and chapter selection for the destination chapter", async () => {
        const paginator = new Paginator({ pages: ["Only"], timeout: 1000 }).addChapter(["A", "B"], { label: "Many" });
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:chapter", [paginator.chapters[1]!.id]));
        await settle();

        const components = vi.mocked(dynaSend).mock.calls.at(-1)![1].components ?? [];
        const json = components.map(c => c.toJSON()) as any[];
        expect(json[0].components[0].options[1].default).toBe(true);
        expect(json.flatMap(row => row.components).some(component => component.custom_id === "paginator:next")).toBe(true);
    });

    it("forces withResponse for fresh interaction sends", async () => {
        const paginator = new Paginator({ pages: ["Only"], timeout: 1000 });
        await sendPaginator(paginator);
        expect(vi.mocked(dynaSend).mock.calls[0]![1].withResponse).toBe(true);
    });

    it("acknowledges competing clicks while only the first slow load runs", async () => {
        const slow = deferred<string>();
        const loader = vi.fn((page: number) => (page === 0 ? Promise.resolve("0") : slow.promise));
        const paginator = new Paginator({ timeout: 1000 }).addPageLoader(3, loader, { label: "Pages" });
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

    it("serializes concurrent programmatic chapter loads", async () => {
        const slow = deferred<string[]>();
        const loader = vi.fn(() => slow.promise);
        const paginator = new Paginator({ pages: ["Current"], timeout: 1000 }).addLazyChapter(loader, { label: "Lazy" });
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
        const paginator = new Paginator({ timeout: 1000, onLoading: () => "Loading" }).addPageLoader(
            2,
            page => (page === 0 ? "Current" : Promise.reject(new Error("load failed"))),
            { label: "Pages" }
        );
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();

        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).toEqual(["Current", "Loading", "Current"]);
    });

    it("lets timeout cleanup win over a pending load and suppresses paginate", async () => {
        const slow = deferred<string>();
        const paginator = new Paginator({ timeout: 1000, onTimeout: ResolveAction.DoNothing }).addPageLoader(
            2,
            page => (page === 0 ? "Current" : slow.promise),
            { label: "Pages" }
        );
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
        const paginator = new Paginator({ pages: ["0", "1"], jump: true, timeout: 1000 }).addChapter(["B"], {
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
            getField: () => "1",
            reply: vi.fn(),
            followUp: vi.fn()
        });
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
            getField: () => "1",
            reply: vi.fn(),
            followUp: vi.fn()
        });
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
        const paginator = new Paginator({ timeout: 1000, onLoading: () => "Loading" }).addLazyChapter(loader, {
            label: "Data"
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
        const paginator = new Paginator({ timeout: 1000 }).addLazyChapter(chapterLoader, { label: "Lazy" });
        await sendPaginator(paginator);
        await paginator.setPage(0, 1);
        await paginator.setPage(0, 0);
        await paginator.refresh();
        expect(chapterLoader).toHaveBeenCalledOnce();
        await paginator.reloadChapter();
        expect(chapterLoader).toHaveBeenCalledTimes(2);

        const pageLoader = vi.fn((page: number) => String(page));
        const pages = new Paginator({ timeout: 1000 }).addPageLoader(2, pageLoader, { label: "Pages" });
        await sendPaginator(pages);
        await pages.setPage(0, 1);
        await pages.setPage(0, 0);
        expect(pageLoader.mock.calls.map(c => c[0])).toEqual([0, 1, 0]);
    });

    it("rejects mixed static formats before send and mixed lazy results before edit", async () => {
        const mixed = new Paginator({ timeout: 1000 }).addChapter(["Ordinary", new ContainerBuilder()], { label: "Mixed" });
        await expect(mixed.send({} as never)).rejects.toThrow("cannot mix ordinary pages");

        vi.spyOn(console, "error").mockImplementation(() => {});
        const lazy = new Paginator({ timeout: 1000 }).addPageLoader(
            2,
            page => (page === 0 ? "Ordinary" : new ContainerBuilder()),
            { label: "Lazy" }
        );
        const { collector } = await sendPaginator(lazy);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();
        expect(vi.mocked(dynaSend)).toHaveBeenCalledOnce();
    });

    it("uses a Components V2 placeholder for a Components V2 page load", async () => {
        const loading = new ContainerBuilder();
        const loaded = new ContainerBuilder();
        const paginator = new Paginator({
            timeout: 1000,
            onLoading: () => ({ containers: [loading] })
        }).addPageLoader(2, page => ({ containers: [page === 0 ? new ContainerBuilder() : loaded] }), {
            label: "V2"
        });
        const { collector } = await sendPaginator(paginator);
        collector.emit("collect", createInteraction("paginator:next"));
        await settle();

        expect(vi.mocked(dynaSend).mock.calls[1]![1].components).toContain(loading);
        expect(vi.mocked(dynaSend).mock.calls[2]![1].components).toContain(loaded);
    });

    it("keeps generated chapter IDs unique and removes custom buttons by insertion position", async () => {
        const custom = (id: string) => new ButtonBuilder().setCustomId(id).setLabel(id).setStyle(ButtonStyle.Secondary);
        const paginator = new Paginator({ pages: ["0", "1"], timeout: 1000 });
        paginator.addChapter(["B"], { label: "B" });
        const removedId = paginator.chapters[1]!.id;
        paginator.spliceChapters(1, 1).addChapter(["C"], { label: "C" });
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
