import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Tenant-isolation tests share one real Postgres database and touch role-level state
    // (SET LOCAL context) — running them concurrently would defeat the point of the
    // concurrency test itself needing controlled interleaving. Keep this file-level for now
    // (small suite); revisit only if the suite grows large enough for it to matter.
    fileParallelism: false,
  },
});
