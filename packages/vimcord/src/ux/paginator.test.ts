import EventEmitter from "node:events";
import { ActionRowBuilder, BaseInteraction, ButtonBuilder, ButtonStyle, Collection, ContainerBuilder } from "discord.js";
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
    it("passes the stop reason and combines the final payload with cleanup", async () => {
        const onResolve = vi.fn(() => ({ action: ResolveAction.ClearComponents, content: "Expired" }));
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onResolve });
        const { message, collector } = await sendPaginator(paginator);
        message.edit.mockResolvedValue(message);
        collector.emit("end", [], "manual");
        await settle();
        expect(onResolve).toHaveBeenCalledWith({ message, reason: "manual" });
        expect(message.edit).toHaveBeenCalledOnce();
        expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "Expired" }));
    });

    it.each([ResolveAction.DisableComponents, ResolveAction.ClearComponents])(
        "preserves reply mention settings when %s on timeout",
        async onResolve => {
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
        }
    );

    it("still cleans up and emits postTimeout when an in-flight refresh rejects", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const paginator = new Paginator({ pages: ["A"], timeout: 1000, onResolve: ResolveAction.DeleteMessage });
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
        const interaction = createInteraction("paginator:chapter", [paginator.chapters[1]!.id]);
        collector.emit("collect", interaction);
        await settle();

        const components = (interaction.update.mock.calls[0]?.[0] as { components: { toJSON(): unknown }[] }).components;
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
        const slow = deferred<string>();
        const paginator = new Paginator({ timeout: 1000, onLoading: () => "Loading" }).addPageLoader(
            2,
            page => (page === 0 ? "Current" : slow.promise),
            { label: "Pages" }
        );
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
        const paginator = new Paginator({ timeout: 1000, onResolve: ResolveAction.DoNothing }).addPageLoader(
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
        const slow = deferred<{ containers: ContainerBuilder[] }>();
        const paginator = new Paginator({
            timeout: 1000,
            onLoading: () => ({ containers: [loading] })
        }).addPageLoader(2, page => (page === 0 ? { containers: [new ContainerBuilder()] } : slow.promise), {
            label: "V2"
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

describe("Paginator acknowledgement and snapshots", () => {
    it("updates a prepared page in one call and keeps the returned snapshot for timeout cleanup", async () => {
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000, onResolve: ResolveAction.ClearComponents });
        const { collector } = await sendPaginator(p);
        const latest = createMessage([new ActionRowBuilder<ButtonBuilder>()]).message;
        const i = createInteraction("paginator:next");
        i.update.mockResolvedValue({ resource: { message: latest } });
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).not.toHaveBeenCalled();
        expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ content: "B", withResponse: true }));
        expect(dynaSend).toHaveBeenCalledTimes(1);
        collector.emit("end", [], "time");
        await settle();
        expect(latest.edit).toHaveBeenCalledWith({ components: [] });
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
        const p = new Paginator({ timeout: 1000, onLoading: loading }).addPageLoader(2, n => Promise.resolve(String(n)), {
            label: "Pages"
        });
        const { collector } = await sendPaginator(p);
        const i = createInteraction("paginator:next");
        collector.emit("collect", i);
        await settle();
        expect(i.deferUpdate).toHaveBeenCalledOnce();
        expect(loading).not.toHaveBeenCalled();
        expect(vi.mocked(dynaSend).mock.calls.map(c => c[1].content)).toEqual(["0", "1"]);
    });

    it("removes creation-only flags when updating an ephemeral message", async () => {
        const { message, collector } = createMessage();
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const p = new Paginator({ pages: ["A", "B"], timeout: 1000 });
        await p.send({} as never, { flags: ["Ephemeral", "SuppressNotifications", "SuppressEmbeds"] });
        const i = createInteraction("paginator:next");
        i.update.mockResolvedValue({ resource: { message } });
        collector.emit("collect", i);
        await settle();
        expect(i.update.mock.calls[0]?.[0]).toMatchObject({ flags: 4 });
    });
});

describe("Paginator chapter replacement", () => {
    it("preserves a chapter by value across reordering and clamps a shortened page list", async () => {
        const p = new Paginator({ timeout: 1000 })
            .addChapter(["Overview"], { label: "Overview", value: "overview" })
            .addChapter(["A0", "A1", "A2"], { label: "A", value: "a" });
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
            .addChapter(["A"], { label: "A" })
            .addChapter(["B0", "B1"], { label: "B" });
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
        const handler = Object.assign(Object.create(BaseInteraction.prototype), { webhook: { editMessage } });
        vi.mocked(dynaSend).mockResolvedValue(message as never);
        const p = new Paginator({ timeout: 1000, onResolve: ResolveAction.DisableComponents }).addChapter(["A"], {
            label: "A"
        });
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
    const p = new Paginator({ timeout: 1000 }).addPageLoader(2, n => (n === 0 ? "A" : slow.promise), {
        value: "a",
        label: "A"
    });
    const { collector } = await sendPaginator(p);
    collector.emit("collect", createInteraction("paginator:next"));
    await settle();
    const replacement = p.replaceChapters([{ value: "a", label: "A", pages: ["New0", "New1"] }]);
    slow.resolve("Old1");
    await replacement;
    expect(vi.mocked(dynaSend).mock.lastCall?.[1].content).toBe("New1");
});
