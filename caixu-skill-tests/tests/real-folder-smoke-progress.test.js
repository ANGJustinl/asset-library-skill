import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("../../", import.meta.url).pathname;
const tempDirs = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function createInputDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "caixu-real-folder-smoke-"));
  tempDirs.push(directory);
  await writeFile(
    join(directory, "transcript.txt"),
    [
      "青海大学 官方成绩单",
      "持有人：测试学生",
      "用途：暑期实习申请",
      "此文件可作为证明材料复用"
    ].join("\n"),
    "utf8"
  );
  return directory;
}

async function createUnsupportedInputDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "caixu-real-folder-smoke-skip-"));
  tempDirs.push(directory);
  await writeFile(join(directory, "archive.zip"), "placeholder", "utf8");
  return directory;
}

async function startMockSkillServer(options = {}) {
  const mode = options.mode ?? "success";
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    const userPrompt =
      payload.messages?.find((message) => message.role === "user")?.content ?? "";
    const getLastMatch = (pattern, fallback) => {
      const matches = [...userPrompt.matchAll(pattern)];
      return matches.at(-1)?.[1] ?? fallback;
    };
    const libraryId = getLastMatch(/"library_id":\s*"([^"]+)"/gu, "lib_test");
    const fileId = getLastMatch(/"file_id":\s*"([^"]+)"/gu, "file_test");
    const fileName = getLastMatch(/"file_name":\s*"([^"]+)"/gu, "transcript.txt");
    const filePath = getLastMatch(/"file_path":\s*"([^"]+)"/gu, "/tmp/transcript.txt");
    let content;

    if (
      userPrompt.includes(
        "Choose the safest ingest route for each local file before low-level extraction"
      )
    ) {
      if (mode === "route_reasoning_only") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "mock-local-skill-model",
            choices: [
              {
                finish_reason: "length",
                message: {
                  reasoning_content: "I should think about the safest route before returning JSON."
                }
              }
            ]
          })
        );
        return;
      }

      content = JSON.stringify({
        decisions: [
          {
            file_id: fileId,
            route: fileName.endsWith(".zip") ? "skip" : "text",
            reason: fileName.endsWith(".zip")
              ? "unsupported_zip_for_ingestion"
              : null
          }
        ]
      });
    } else if (
      mode === "rate_limit" &&
      userPrompt.includes(
        "Decide which parsed files should enter the asset library"
      )
    ) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rate limited" } }));
      return;
    } else if (
      userPrompt.includes(
        "Decide which parsed files should enter the asset library"
      )
    ) {
      content = JSON.stringify({
        decisions: [
          {
            file_id: fileId,
            include_in_library: true,
            document_role: "personal_proof",
            reason: null
          }
        ]
      });
    } else if (
      userPrompt.includes(
        "Extract canonical asset_cards for triaged files that should enter the asset library"
      )
    ) {
      content = JSON.stringify({
        decisions: [
          {
            file_id: fileId,
            asset_card: {
              schema_version: "1.0",
              library_id: libraryId,
              asset_id: `asset_${fileId}`,
              material_type: "proof",
              title: "官方成绩单",
              holder_name: null,
              issuer_name: "青海大学",
              issue_date: null,
              expiry_date: null,
              validity_status: "long_term",
              agent_tags: [
                "doc:transcript",
                "entity:transcript",
                "use:summer_internship_application",
                "risk:auto"
              ],
              reusable_scenarios: ["summer_internship_application"],
              sensitivity_level: "medium",
              source_files: [
                {
                  file_id: fileId,
                  file_name: fileName,
                  mime_type: "text/plain",
                  file_path: filePath
                }
              ],
              confidence: 0.92,
              normalized_summary: "青海大学 官方成绩单",
              asset_state: "active",
              review_status: "auto",
              last_verified_at: null
            },
            skip_reason: null
          }
        ]
      });
    } else if (
      userPrompt.includes(
        "Conservatively merge obvious duplicate versions without creating new assets"
      )
    ) {
      content = JSON.stringify({
        merged_assets: []
      });
    } else {
      content = JSON.stringify({
        ok: true
      });
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "mock-local-skill-model",
        choices: [
          {
            message: {
              content
            }
          }
        ]
      })
    );
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock skill server.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v4/chat/completions`
  };
}

async function runRealFolderSmoke({ cliProgress }) {
  const inputDir = await createInputDirectory();
  const { server, baseUrl } = await startMockSkillServer();

  try {
    const { stdout } = await execFileAsync(
      "node",
      ["scripts/real-folder-smoke.mjs", inputDir],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CAIXU_PARSE_MODE: "local",
          CAIXU_FILE_BATCH_SIZE: "1",
          CAIXU_CLI_PROGRESS: cliProgress ? "true" : "false",
          CAIXU_CLI_HEARTBEAT_MS: "1000",
          CAIXU_AGENT_API_KEY: "mock-agent-key",
          CAIXU_AGENT_MODEL: "glm-4.6",
          CAIXU_AGENT_BASE_URL: baseUrl,
          CAIXU_AGENT_TIMEOUT_MS: "5000",
          CAIXU_AGENT_HTTP_MAX_ATTEMPTS: "2",
          CAIXU_AGENT_HTTP_BASE_DELAY_MS: "10",
          CAIXU_AGENT_HTTP_MAX_DELAY_MS: "10",
          CAIXU_AGENT_MIN_INTERVAL_MS: "0"
        },
        maxBuffer: 10 * 1024 * 1024
      }
    );

    return JSON.parse(stdout);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function runRealFolderSmokeExpectFailure({ inputDir, mode = "rate_limit" }) {
  const { server, baseUrl } = await startMockSkillServer({ mode });

  try {
    const result = await execFileAsync("node", ["scripts/real-folder-smoke.mjs", inputDir], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CAIXU_PARSE_MODE: "local",
        CAIXU_FILE_BATCH_SIZE: "1",
        CAIXU_CLI_PROGRESS: "true",
        CAIXU_CLI_HEARTBEAT_MS: "1000",
        CAIXU_AGENT_API_KEY: "mock-agent-key",
        CAIXU_AGENT_MODEL: "glm-4.6",
        CAIXU_AGENT_BASE_URL: baseUrl,
        CAIXU_AGENT_TIMEOUT_MS: "5000",
        CAIXU_AGENT_HTTP_MAX_ATTEMPTS: "1",
        CAIXU_AGENT_HTTP_BASE_DELAY_MS: "10",
        CAIXU_AGENT_HTTP_MAX_DELAY_MS: "10",
        CAIXU_AGENT_MIN_INTERVAL_MS: "0",
        CAIXU_BUILD_FAILURE_STREAK_LIMIT: "2",
        CAIXU_BUILD_RATE_LIMIT_FAILURE_LIMIT: "1"
      },
      maxBuffer: 10 * 1024 * 1024
    });

    const summary = JSON.parse(result.stdout);
    const runRoot = summary.run_root;
    const progressJsonl = await readFile(join(runRoot, "progress.jsonl"), "utf8");
    return {
      runRoot,
      summary,
      events: progressJsonl
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    };
  } catch (error) {
    const stderr = error?.stderr ?? "";
    const match = /run_root=([^\s]+)\s/u.exec(stderr);
    if (!match?.[1]) {
      throw error;
    }
    const runRoot = match[1];
    const summary = JSON.parse(await readFile(join(runRoot, "summary.json"), "utf8"));
    const progressJsonl = await readFile(join(runRoot, "progress.jsonl"), "utf8");
    return {
      runRoot,
      summary,
      events: progressJsonl
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe("real-folder-smoke JSONL progress", () => {
  it("writes append-only progress.jsonl events while keeping stdout as final summary JSON", async () => {
    const summary = await runRealFolderSmoke({ cliProgress: true });
    const progressJsonlPath = join(summary.run_root, "progress.jsonl");
    const raw = await readFile(progressJsonlPath, "utf8");
    const events = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).event);

    expect(summary.asset_cards_count).toBe(1);
    expect(events).toEqual(
      expect.arrayContaining([
        "run.start",
        "batch.parse.start",
        "batch.parse.complete",
        "batch.build.start",
        "batch.build.complete",
        "run.complete"
      ])
    );
  });

  it("keeps progress.json as snapshot and skips progress.jsonl when CAIXU_CLI_PROGRESS=false", async () => {
    const summary = await runRealFolderSmoke({ cliProgress: false });
    const progressPath = join(summary.run_root, "progress.json");
    const progressJsonlPath = join(summary.run_root, "progress.jsonl");

    await expect(access(progressPath, fsConstants.F_OK)).resolves.toBeUndefined();
    await expect(access(progressJsonlPath, fsConstants.F_OK)).rejects.toBeTruthy();
  });

  it("skips build stage entirely when a batch produces no parsed files", async () => {
    const inputDir = await createUnsupportedInputDirectory();
    const { server, baseUrl } = await startMockSkillServer();

    try {
      const { stdout } = await execFileAsync(
        "node",
        ["scripts/real-folder-smoke.mjs", inputDir],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CAIXU_PARSE_MODE: "local",
            CAIXU_FILE_BATCH_SIZE: "1",
            CAIXU_CLI_PROGRESS: "true",
            CAIXU_CLI_HEARTBEAT_MS: "1000",
            CAIXU_AGENT_API_KEY: "mock-agent-key",
            CAIXU_AGENT_MODEL: "glm-4.6",
            CAIXU_AGENT_BASE_URL: baseUrl,
            CAIXU_AGENT_TIMEOUT_MS: "5000",
            CAIXU_AGENT_HTTP_MAX_ATTEMPTS: "1",
            CAIXU_AGENT_HTTP_BASE_DELAY_MS: "10",
            CAIXU_AGENT_HTTP_MAX_DELAY_MS: "10",
            CAIXU_AGENT_MIN_INTERVAL_MS: "0"
          },
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const summary = JSON.parse(stdout);
      const progressJsonlPath = join(summary.run_root, "progress.jsonl");
      const raw = await readFile(progressJsonlPath, "utf8");
      const events = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).event);

      expect(summary.parsed_count).toBe(0);
      expect(summary.skipped_count).toBe(1);
      expect(events).not.toContain("batch.build.start");
      expect(events).toContain("batch.build.complete");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("records rate-limited build batches in a failed summary when no assets were persisted", async () => {
    const inputDir = await createInputDirectory();
    await writeFile(
      join(inputDir, "transcript-2.txt"),
      ["第二份成绩单", "持有人：测试学生二号", "用途：暑期实习申请"].join("\n"),
      "utf8"
    );

    const { summary, events } = await runRealFolderSmokeExpectFailure({
      inputDir,
      mode: "rate_limit"
    });

    expect(summary.build_status).toBe("failed");
    expect(summary.fatal_error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("BUILD_ASSET_RATE_LIMIT_CIRCUIT_OPEN")
      })
    );
    expect(summary.build_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SKILL_RUNNER_RATE_LIMITED"
        })
      ])
    );
    expect(summary.asset_cards_count).toBe(0);
    expect(events.some((event) => event.event === "http.retry_exhausted")).toBe(true);
    expect(events.filter((event) => event.event === "batch.build.start").length).toBeGreaterThan(0);
    expect(
      events.some((event) => event.event === "run.complete") ||
        events.some((event) => event.event === "run.failed")
    ).toBe(true);
  });

  it("falls back to suggested_route when ingest route decision returns reasoning-only responses", async () => {
    const inputDir = await createInputDirectory();
    const { server, baseUrl } = await startMockSkillServer({ mode: "route_reasoning_only" });

    try {
      const { stdout } = await execFileAsync(
        "node",
        ["scripts/real-folder-smoke.mjs", inputDir],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CAIXU_PARSE_MODE: "local",
            CAIXU_FILE_BATCH_SIZE: "1",
            CAIXU_CLI_PROGRESS: "true",
            CAIXU_CLI_HEARTBEAT_MS: "1000",
            CAIXU_AGENT_API_KEY: "mock-agent-key",
            CAIXU_AGENT_MODEL: "glm-4.6",
            CAIXU_AGENT_BASE_URL: baseUrl,
            CAIXU_AGENT_TIMEOUT_MS: "5000",
            CAIXU_AGENT_HTTP_MAX_ATTEMPTS: "1",
            CAIXU_AGENT_HTTP_BASE_DELAY_MS: "10",
            CAIXU_AGENT_HTTP_MAX_DELAY_MS: "10",
            CAIXU_AGENT_MIN_INTERVAL_MS: "0",
            CAIXU_INGEST_ROUTE_FALLBACK_TO_SUGGESTED: "true"
          },
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const summary = JSON.parse(stdout);
      const progressJsonlPath = join(summary.run_root, "progress.jsonl");
      const raw = await readFile(progressJsonlPath, "utf8");
      const events = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      expect(summary.parsed_count).toBe(1);
      expect(summary.warning_count).toBeGreaterThanOrEqual(1);
      expect(events.some((event) => event.event === "skill.attempt.failed")).toBe(true);
      expect(summary.failed_files).toEqual([]);
      expect(summary.warning_files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "INGEST_ROUTE_FALLBACK_SUGGESTED_ROUTE"
          })
        ])
      );
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
