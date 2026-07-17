import type { WorkspacePackage } from "./publishWorkspace.js";

import { describe, expect, it } from "vitest";
import {
    getNextAvailableVersion,
    parsePackageSelection,
    parsePublishedVersionsResponse,
    sortPackagesForPublish
} from "./publishWorkspace.js";

function createPackage(name: string, workspaceDependencies: readonly string[] = []): WorkspacePackage {
    const version = "1.0.0";
    return {
        name,
        version,
        path: `/workspace/${name}`,
        manifestPath: `/workspace/${name}/package.json`,
        manifest: { name, version },
        originalManifest: "",
        workspaceDependencies
    };
}

describe("workspace publisher", () => {
    it("selects individual packages, ranges, and all packages", () => {
        expect(parsePackageSelection("1,3-4", 5)).toEqual([0, 2, 3]);
        expect(parsePackageSelection("all", 3)).toEqual([0, 1, 2]);
        expect(parsePackageSelection("2,2", 3)).toEqual([1]);
        expect(() => parsePackageSelection("4", 3)).toThrow("Invalid package selection");
        expect(() => parsePackageSelection("3-1", 3)).toThrow("Invalid package selection");
    });

    it("increments after the highest stable local or registry version", () => {
        expect(getNextAvailableVersion("1.2.3", ["1.2.2", "1.2.3"])).toBe("1.2.4");
        expect(getNextAvailableVersion("1.2.3", ["1.3.0", "1.4.0-beta.1"])).toBe("1.3.1");
        expect(getNextAvailableVersion("2.0.0", [])).toBe("2.0.1");
        expect(() => getNextAvailableVersion("2.0.0-beta.1", [])).toThrow("not a stable");
    });

    it("treats PNPM's successful registry 404 response as an unpublished package", () => {
        expect(
            parsePublishedVersionsResponse("new-package", {
                error: { code: "ERR_PNPM_FETCH_404", message: "Not Found - 404" }
            })
        ).toEqual([]);
        expect(parsePublishedVersionsResponse("published-package", ["1.0.0", "1.0.1"])).toEqual(["1.0.0", "1.0.1"]);
    });

    it("publishes workspace dependencies before their dependents", () => {
        const core = createPackage("@vimcord/core");
        const plugin = createPackage("@vimcord/plugin", ["@vimcord/core"]);
        const wrapper = createPackage("vimcord", ["@vimcord/core"]);

        expect(sortPackagesForPublish([plugin, wrapper, core]).map(pkg => pkg.name)).toEqual([
            "@vimcord/core",
            "@vimcord/plugin",
            "vimcord"
        ]);
    });

    it("rejects selected workspace dependency cycles", () => {
        const first = createPackage("first", ["second"]);
        const second = createPackage("second", ["first"]);
        expect(() => sortPackagesForPublish([first, second])).toThrow("Circular workspace dependency");
    });
});
