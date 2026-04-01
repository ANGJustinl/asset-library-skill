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
        zhipuParserMode: "export",
        zhipuOcrEnabled: "true",
        vlmModel: "glm-4.6v",
        vlmPdfRenderer: "pdftocairo",
        zhipuParserApiKey: "parser-key",
        zhipuOcrApiKey: "ocr-key",
        zhipuVlmApiKey: "vlm-key",
        zhipuApiKey: "test-key",
        sqlitePath: "/tmp/caixu.sqlite",
        judgeDemoUrl: "https://example.com/judge-demo"
      }),
      "utf8"
    );

    const parsed = readEnvFile(envPath);
    expect(parsed.CAIXU_PARSE_MODE).toBe("auto");
    expect(parsed.CAIXU_ZHIPU_PARSER_MODE).toBe("export");
    expect(parsed.CAIXU_ZHIPU_OCR_ENABLED).toBe("true");
    expect(parsed.CAIXU_VLM_MODEL).toBe("glm-4.6v");
    expect(parsed.CAIXU_VLM_PDF_RENDERER).toBe("pdftocairo");
    expect(parsed.CAIXU_ZHIPU_PARSER_API_KEY).toBe("parser-key");
    expect(parsed.CAIXU_ZHIPU_OCR_API_KEY).toBe("ocr-key");
    expect(parsed.CAIXU_ZHIPU_VLM_API_KEY).toBe("vlm-key");
    expect(parsed.ZHIPU_API_KEY).toBe("test-key");
    expect(parsed.CAIXU_SQLITE_PATH).toBe("/tmp/caixu.sqlite");
    expect(parsed.CAIXU_JUDGE_DEMO_URL).toBe("https://example.com/judge-demo");
  });

  it("builds MCP server specs against compiled dist entrypoints", () => {
    const specs = buildMcpServerSpecs(
      {},
      {
        parseMode: "auto",
        zhipuParserMode: "export",
        zhipuOcrEnabled: "true",
        vlmModel: "glm-4.6v",
        vlmPdfRenderer: "pdftocairo",
        zhipuParserApiKey: "parser-key",
        zhipuOcrApiKey: "ocr-key",
        zhipuVlmApiKey: "vlm-key",
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
    expect(specs[0].env).toMatchObject({
      CAIXU_ZHIPU_PARSER_MODE: "export",
      CAIXU_ZHIPU_OCR_ENABLED: "true",
      CAIXU_VLM_MODEL: "glm-4.6v",
      CAIXU_VLM_PDF_RENDERER: "pdftocairo",
      CAIXU_ZHIPU_PARSER_API_KEY: "parser-key",
      CAIXU_ZHIPU_OCR_API_KEY: "ocr-key",
      CAIXU_ZHIPU_VLM_API_KEY: "vlm-key",
      ZHIPU_API_KEY: "secret"
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
