import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const directory = await mkdtemp(join(tmpdir(), "caixu-live-build-asset-"));
  tempDirs.push(directory);
  await writeFile(
    join(directory, "transcript.txt"),
    [
      "青海大学 官方成绩单",
      "持有人：测试学生",
      "用途：暑期实习申请"
    ].join("\n"),
    "utf8"
  );
  return directory;
}

async function startMockSkillServer() {
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
      content = JSON.stringify({
        decisions: [
          {
            file_id: fileId,
            route: "text",
            reason: null
          }
        ]
      });
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
      content = JSON.stringify({ ok: true });
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "mock-live-build-asset",
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

describe("live-build-asset smoke wrapper", () => {
  it("fails fast when required live env is missing", async () => {
    const inputDir = await createInputDirectory();

    await expect(
      execFileAsync("node", ["scripts/live-build-asset-smoke.mjs", inputDir], {
        cwd: repoRoot,
        env: {
          ...process.env,
          CAIXU_AGENT_API_KEY: "",
          CAIXU_ZHIPU_PARSER_API_KEY: "",
          CAIXU_ZHIPU_OCR_API_KEY: "",
          ZHIPU_API_KEY: ""
        }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing CAIXU_AGENT_API_KEY or ZHIPU_API_KEY")
    });
  });

  it("fails fast when the input directory is missing", async () => {
    await expect(
      execFileAsync("node", ["scripts/live-build-asset-smoke.mjs", "/tmp/not-found-caixu"], {
        cwd: repoRoot,
        env: process.env
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Input directory does not exist")
    });
  });

  it("runs the real-folder smoke with conservative live defaults", async () => {
    const inputDir = await createInputDirectory();
    const { server, baseUrl } = await startMockSkillServer();

    try {
      const { stdout, stderr } = await execFileAsync(
        "node",
        ["scripts/live-build-asset-smoke.mjs", inputDir],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            CAIXU_PARSE_MODE: "local",
            CAIXU_AGENT_API_KEY: "mock-agent-key",
            CAIXU_AGENT_BASE_URL: baseUrl,
            CAIXU_ZHIPU_PARSER_API_KEY: "mock-parser-key",
            CAIXU_ZHIPU_OCR_API_KEY: "mock-ocr-key",
            CAIXU_AGENT_TIMEOUT_MS: "5000",
            CAIXU_AGENT_HTTP_MAX_ATTEMPTS: "2",
            CAIXU_AGENT_HTTP_BASE_DELAY_MS: "10",
            CAIXU_AGENT_HTTP_MAX_DELAY_MS: "10",
            CAIXU_AGENT_MIN_INTERVAL_MS: "0"
          },
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const summary = JSON.parse(stdout);
      expect(summary.asset_cards_count).toBe(1);
      expect(stderr).toContain("[caixu-live] starting live build-asset smoke");
      expect(stderr).toContain("progress_jsonl=");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
