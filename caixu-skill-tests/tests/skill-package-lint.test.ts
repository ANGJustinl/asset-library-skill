import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");

const skills = [
  "caixu-ingest-materials",
  "caixu-build-asset-library",
  "caixu-maintain-asset-library",
  "caixu-query-assets",
  "caixu-check-lifecycle",
  "caixu-build-package",
  "caixu-submit-demo"
] as const;

const scriptedSkills = new Set([
  "caixu-check-lifecycle",
  "caixu-build-package",
  "caixu-submit-demo"
]);

const structuredOutputSkills = new Set([
  "caixu-build-asset-library",
  "caixu-maintain-asset-library",
  "caixu-query-assets",
  "caixu-check-lifecycle",
  "caixu-build-package",
  "caixu-submit-demo"
]);

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/u);
  if (!match) {
    return {};
  }

  const entries: Record<string, string> = {};
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.includes(":")) {
      continue;
    }
    const [key, ...rest] = line.split(":");
    entries[key.trim()] = rest.join(":").trim();
  }
  return entries;
}

function referencedRelativePaths(text: string): string[] {
  const links = Array.from(text.matchAll(/\((references\/[^)]+|scripts\/[^)]+)\)/g)).map(
    (match) => match[1]!
  );
  return [...new Set(links)];
}

describe("skill package lint", () => {
  it("every skill package includes self-contained metadata and references", () => {
    for (const skill of skills) {
      const skillPath = `${skill}/SKILL.md`;
      const openaiYamlPath = `${skill}/agents/openai.yaml`;
      const workflowPath = `${skill}/references/workflow.md`;
      const contractsPath = `${skill}/references/tool-contracts.md`;
      const failureModesPath = `${skill}/references/failure-modes.md`;

      expect(existsSync(join(repoRoot, skillPath)), `${skillPath} should exist`).toBe(true);
      expect(existsSync(join(repoRoot, openaiYamlPath)), `${openaiYamlPath} should exist`).toBe(true);
      expect(existsSync(join(repoRoot, workflowPath)), `${workflowPath} should exist`).toBe(true);
      expect(existsSync(join(repoRoot, contractsPath)), `${contractsPath} should exist`).toBe(true);
      expect(existsSync(join(repoRoot, failureModesPath)), `${failureModesPath} should exist`).toBe(true);
    }
  });

  it("frontmatter names match directory names and descriptions are explicit", () => {
    for (const skill of skills) {
      const skillText = read(`${skill}/SKILL.md`);
      const frontmatter = parseFrontmatter(skillText);
      expect(frontmatter.name).toBe(skill);
      expect(frontmatter.description?.length ?? 0).toBeGreaterThan(20);
      expect(frontmatter.description).toContain("Use when");
    }
  });

  it("openai metadata exposes display name and short description", () => {
    for (const skill of skills) {
      const text = read(`${skill}/agents/openai.yaml`);
      expect(text).toContain("interface:");
      expect(text).toContain("display_name:");
      expect(text).toContain("short_description:");
    }
  });

  it("all referenced references and scripts exist", () => {
    for (const skill of skills) {
      const skillText = read(`${skill}/SKILL.md`);
      for (const relativePath of referencedRelativePaths(skillText)) {
        expect(
          existsSync(join(repoRoot, skill, relativePath)),
          `${skill} references missing path ${relativePath}`
        ).toBe(true);
      }
    }
  });

  it("only fragile skills include scripts, and they mention them explicitly", () => {
    for (const skill of skills) {
      const skillText = read(`${skill}/SKILL.md`);
      const scriptsDir = join(repoRoot, skill, "scripts");
      if (scriptedSkills.has(skill)) {
        expect(existsSync(scriptsDir), `${skill} should include scripts/`).toBe(true);
        expect(skillText).toContain("scripts/");
      } else {
        expect(existsSync(scriptsDir), `${skill} should not include scripts/`).toBe(false);
      }
    }
  });

  it("structured-output skills include output patterns and reference them explicitly", () => {
    for (const skill of structuredOutputSkills) {
      const skillText = read(`${skill}/SKILL.md`);
      const outputPatternsPath = `${skill}/references/output-patterns.md`;
      expect(
        existsSync(join(repoRoot, outputPatternsPath)),
        `${outputPatternsPath} should exist`
      ).toBe(true);
      expect(skillText).toContain("references/output-patterns.md");
    }
  });
});
