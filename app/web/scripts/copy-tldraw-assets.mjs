// Self-hosts tldraw's static assets (icons/fonts/translations/embed-icons) under public/, so the
// browser never fetches them from cdn.tldraw.com — required both by this app's strict CSP
// (docs/SECURITY.md §6, no external origins allowed) and by the project's general "no
// third-party SaaS dependency for core features" stance (docs/WHITEBOARD.md §2). Regenerated on
// every `npm install` (see package.json's postinstall) from @tldraw/assets, a real published
// package that ships exactly these files for self-hosting — not copied by hand, so it always
// matches the installed tldraw version. public/tldraw-assets/ itself is gitignored, same as any
// other build output.
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = join(__dirname, "..", "node_modules", "@tldraw", "assets");
const DEST_ROOT = join(__dirname, "..", "public", "tldraw-assets");

const DIRS = ["icons", "fonts", "translations", "embed-icons"];

async function main() {
  if (!existsSync(SOURCE_ROOT)) {
    console.error(`[copy-tldraw-assets] ${SOURCE_ROOT} not found — is @tldraw/assets installed?`);
    process.exit(1);
  }

  await rm(DEST_ROOT, { recursive: true, force: true });
  await mkdir(DEST_ROOT, { recursive: true });

  for (const dir of DIRS) {
    await cp(join(SOURCE_ROOT, dir), join(DEST_ROOT, dir), { recursive: true });
  }

  console.log(`[copy-tldraw-assets] copied ${DIRS.join(", ")} to public/tldraw-assets/`);
}

await main();
