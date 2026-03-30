import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEnvFileContent,
  buildMcpServerSpecs,
  detectAutoClawInstallation,
  inspectSkillLink,
  readEnvFile,
  repoRoot
} from "../../scripts/lib/autoclaw-helpers.mjs";

const tempDirs = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "caixu-autoclaw-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("autoclaw helpers", () => {
  it("uses explicit autoclaw home when provided", () => {
    const customHome = createTempDir();
    const profileDir = join(customHome, ".openclaw-autoclaw");
    const detected = detectAutoClawInstallation(profileDir);

    expect(detected.autoClawHome).toBe(resolve(profileDir));
    expect(detected.openClawConfigPath).toBe(join(resolve(profileDir), "openclaw.json"));
    expect(detected.managedSkillsDir).toBe(join(resolve(profileDir), "skills"));
  });

  it("round-trips generated env files", () => {
    const dir = createTempDir();
    const envPath = join(dir, "caixu.env");
    writeFileSync(
      envPath,
      buildEnvFileContent({
        parseMode: "auto",
        zhipuApiKey: "test-key",
        sqlitePath: "/tmp/caixu.sqlite",
        judgeDemoUrl: "https://example.com/judge-demo"
      }),
      "utf8"
    );

    const parsed = readEnvFile(envPath);
    expect(parsed.CAIXU_PARSE_MODE).toBe("auto");
    expect(parsed.ZHIPU_API_KEY).toBe("test-key");
    expect(parsed.CAIXU_SQLITE_PATH).toBe("/tmp/caixu.sqlite");
    expect(parsed.CAIXU_JUDGE_DEMO_URL).toBe("https://example.com/judge-demo");
  });

  it("builds MCP server specs against compiled dist entrypoints", () => {
    const specs = buildMcpServerSpecs(
      {},
      {
        parseMode: "auto",
        zhipuApiKey: "secret",
        sqlitePath: "/tmp/caixu.sqlite",
        judgeDemoUrl: "https://example.com/judge-demo"
      }
    );

    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({
      name: "caixu-ocr-mcp",
      command: "node",
      args: [join(repoRoot, "caixu-ocr-mcp", "dist", "index.js")]
    });
    expect(specs[1]).toMatchObject({
      name: "caixu-data-mcp",
      command: "node",
      args: [join(repoRoot, "caixu-data-mcp", "dist", "index.js")]
    });
  });

  it("inspects correct and wrong skill symlinks", () => {
    const dir = createTempDir();
    const sourceDir = join(dir, "source-skill");
    const targetDir = join(dir, "managed-skill");
    const wrongSourceDir = join(dir, "wrong-skill");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(wrongSourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "SKILL.md"), "# demo\n", "utf8");
    writeFileSync(join(wrongSourceDir, "SKILL.md"), "# wrong\n", "utf8");

    expect(inspectSkillLink(targetDir, sourceDir).status).toBe("missing");

    symlinkSync(sourceDir, targetDir, "dir");
    expect(inspectSkillLink(targetDir, sourceDir).status).toBe("correct_symlink");

    rmSync(targetDir, { recursive: true, force: true });
    symlinkSync(wrongSourceDir, targetDir, "dir");
    expect(inspectSkillLink(targetDir, sourceDir).status).toBe("wrong_symlink");
  });
});
