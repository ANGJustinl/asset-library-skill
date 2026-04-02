import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, skillSpecs } from "../../scripts/lib/skill-specs.mjs";

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

function read(pathname: string): string {
  return readFileSync(pathname, "utf8");
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
    for (const skill of skillSpecs) {
      const openaiYamlPath = join(skill.sourceDir, "agents", "openai.yaml");
      const workflowPath = join(skill.sourceDir, "references", "workflow.md");
      const contractsPath = join(skill.sourceDir, "references", "tool-contracts.md");
      const failureModesPath = join(skill.sourceDir, "references", "failure-modes.md");

      expect(existsSync(skill.skillFile), `${skill.skillFile} should exist`).toBe(true);
      expect(existsSync(openaiYamlPath), `${openaiYamlPath} should exist`).toBe(true);
      expect(existsSync(workflowPath), `${workflowPath} should exist`).toBe(true);
      expect(existsSync(contractsPath), `${contractsPath} should exist`).toBe(true);
      expect(existsSync(failureModesPath), `${failureModesPath} should exist`).toBe(true);
    }
  });

  it("frontmatter names match directory names and descriptions are explicit", () => {
    for (const skill of skillSpecs) {
      const skillText = read(skill.skillFile);
      const frontmatter = parseFrontmatter(skillText);
      expect(frontmatter.name).toBe(skill.skillName);
      expect(frontmatter.description?.length ?? 0).toBeGreaterThan(20);
      expect(frontmatter.description).toContain("Use when");
      if (skill.skillName === "caixu-skill") {
        expect(frontmatter.description).toContain("把这些材料建成资产库");
      } else {
        expect(frontmatter.description).toContain("Prefer caixu-skill");
      }
    }
  });

  it("openai metadata exposes display name and short description", () => {
    for (const skill of skillSpecs) {
      const text = read(join(skill.sourceDir, "agents", "openai.yaml"));
      expect(text).toContain("interface:");
      expect(text).toContain("display_name:");
      expect(text).toContain("short_description:");
    }
  });

  it("all referenced references and scripts exist", () => {
    for (const skill of skillSpecs) {
      const skillText = read(skill.skillFile);
      for (const relativePath of referencedRelativePaths(skillText)) {
        expect(
          existsSync(join(skill.sourceDir, relativePath)),
          `${skill.skillName} references missing path ${relativePath}`
        ).toBe(true);
      }
    }
  });

  it("only fragile skills include scripts, and they mention them explicitly", () => {
    for (const skill of skillSpecs) {
      const skillText = read(skill.skillFile);
      const scriptsDir = join(skill.sourceDir, "scripts");
      if (scriptedSkills.has(skill.skillName)) {
        expect(existsSync(scriptsDir), `${skill.skillName} should include scripts/`).toBe(true);
        expect(skillText).toContain("scripts/");
      } else if (skill.packageType === "directory") {
        expect(existsSync(scriptsDir), `${skill.skillName} should not include scripts/`).toBe(false);
      } else {
        expect(skillText).not.toContain("(scripts/");
      }
    }
  });

  it("structured-output skills include output patterns and reference them explicitly", () => {
    for (const skill of skillSpecs.filter((spec) => structuredOutputSkills.has(spec.skillName))) {
      const skillText = read(skill.skillFile);
      const outputPatternsPath = join(skill.sourceDir, "references", "output-patterns.md");
      expect(
        existsSync(outputPatternsPath),
        `${outputPatternsPath} should exist`
      ).toBe(true);
      expect(skillText).toContain("references/output-patterns.md");
    }
  });

  it("root caixu-skill only treats root SKILL.md, agents, and references as skill resources", () => {
    const rootSkill = skillSpecs.find((skill) => skill.skillName === "caixu-skill");
    expect(rootSkill).toBeTruthy();
    const skillText = read(rootSkill!.skillFile);
    const references = referencedRelativePaths(skillText);
    const installPath = join(repoRoot, "references", "install.md");

    expect(rootSkill!.packageType).toBe("root");
    expect(existsSync(installPath), `${installPath} should exist`).toBe(true);
    expect(skillText).toContain("references/install.md");
    expect(references.every((reference) => reference.startsWith("references/"))).toBe(true);
    expect(skillText).not.toContain("(docs/");
    expect(skillText).not.toContain("(scripts/");
    expect(existsSync(join(repoRoot, "scripts"))).toBe(true);
    expect(existsSync(join(repoRoot, "docs"))).toBe(true);
  });
});
