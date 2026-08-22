import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readdir, readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";

async function readD1Migrations(directory: string) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).toSorted();
  return Promise.all(
    names.map(async (name) => ({
      name,
      queries: (await readFile(`${directory}/${name}`, "utf8"))
        .split("--> statement-breakpoint")
        .map((query) => query.trim())
        .filter(Boolean),
    })),
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./drizzle"),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
