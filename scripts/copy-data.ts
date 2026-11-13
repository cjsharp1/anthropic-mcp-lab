/**
 * copy-data.ts — copies server/data into dist, after a build.
 *
 * Run as part of:  npm run build
 *
 * tsc compiles .ts and ignores everything else. Without this step a
 * build produces a dist/ missing the files the resources serve, and
 * `node dist/server/index.js` crashes on first read:
 *
 *   Error: ENOENT ... dist\server\data\server-info.json
 *
 * That failure is easy to miss, because `npm run dev` uses tsx against
 * server/ directly, where the path resolves. Nothing in package.json
 * runs the compiled output, so nothing exercises the broken path. The
 * chat lab shipped exactly this bug before catching it.
 *
 * A script rather than a shell command in package.json, because
 * `cp -r` and `xcopy` are not the same on both platforms and this
 * project is developed on Windows and read on everything else.
 *
 * ---------------------------------------------------------------------------
 * One difference from the chat lab's copy of this script
 * ---------------------------------------------------------------------------
 *
 * This one tolerates server/data not existing. The chat lab's version
 * assumes it does. Both directories exist today — this server's holds
 * the Markdown behind the protocol-notes resource — so the difference
 * no longer shows, but it is kept: this project has fewer data files
 * than the chat lab and could lose its last one, and a build step that
 * fails on an empty directory is a bad trade.
 *
 * Absence is the only tolerated failure: a data directory that exists
 * but cannot be read still throws.
 */

import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const FROM = join(ROOT, "server", "data");
const TO = join(ROOT, "dist", "server", "data");

/**
 * Whether a path exists and is a directory.
 *
 * Distinguishes "not there" from "there but broken": ENOENT returns
 * false, anything else is rethrown. A data directory that exists and
 * cannot be stat'd is a real problem and should not be swallowed by a
 * check meant to handle its absence.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (!(await isDirectory(FROM))) {
    console.log("No server/data to copy — skipping.");
    return;
  }

  // recursive handles the directory itself; mkdir first so the copy
  // does not depend on tsc having created the parent.
  await mkdir(join(ROOT, "dist", "server"), { recursive: true });
  await cp(FROM, TO, { recursive: true });

  console.log("Copied server/data → dist/server/data");
}

await main();
