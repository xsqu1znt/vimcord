import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./packages/vimcord/src", import.meta.url))
        }
    },
    test: {
        include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
        environment: "node",
        globals: true
    }
});
