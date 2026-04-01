import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { appendJsonlRecord } from "../../scripts/lib/jsonl-progress.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("jsonl progress writer", () => {
  it("appends newline-delimited JSON records without truncating previous events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "caixu-jsonl-progress-"));
    tempDirs.push(directory);
    const filePath = join(directory, "progress.jsonl");

    appendJsonlRecord(filePath, {
      event: "run.start",
      stage: "starting",
      status: "running"
    });
    appendJsonlRecord(filePath, {
      event: "batch.parse.start",
      stage: "parsing",
      status: "running"
    });

    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: "run.start"
      }),
      expect.objectContaining({
        event: "batch.parse.start"
      })
    ]);
  });
});
