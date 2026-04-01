import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("../../", import.meta.url).pathname;

describe("maintain-library smoke", () => {
  it("runs the maintenance flow against a fixture library", async () => {
    const { stdout } = await execFileAsync("node", ["scripts/maintain-library-smoke.mjs"], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024
    });

    const summary = JSON.parse(stdout);
    expect(summary.library_id).toBeTruthy();
    expect(summary.review_queue_before).toBe(1);
    expect(summary.review_queue_after).toBe(0);
    expect(summary.active_query_after_archive).not.toContain(summary.archived_asset_id);
    expect(summary.final_active_assets).toContain(summary.archived_asset_id);
  });
});
