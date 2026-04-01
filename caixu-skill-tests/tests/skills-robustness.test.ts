import { readFileSync } from "node:fs";
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

const validTools = new Set([
  "caixu-data-mcp.create_or_load_library",
  "caixu-data-mcp.list_libraries",
  "caixu-data-mcp.get_library_overview",
  "caixu-data-mcp.create_pipeline_run",
  "caixu-data-mcp.append_pipeline_step",
  "caixu-data-mcp.complete_pipeline_run",
  "caixu-ocr-mcp.list_local_files",
  "caixu-ocr-mcp.read_local_text_file",
  "caixu-ocr-mcp.extract_parser_text",
  "caixu-ocr-mcp.extract_visual_text",
  "caixu-ocr-mcp.render_pdf_pages",
  "caixu-data-mcp.upsert_parsed_files",
  "caixu-data-mcp.get_parsed_files",
  "caixu-data-mcp.upsert_asset_cards",
  "caixu-data-mcp.patch_asset_card",
  "caixu-data-mcp.archive_asset",
  "caixu-data-mcp.restore_asset",
  "caixu-data-mcp.list_review_queue",
  "caixu-data-mcp.upsert_merged_assets",
  "caixu-data-mcp.query_assets",
  "caixu-data-mcp.get_rule_profile",
  "caixu-data-mcp.write_lifecycle_run",
  "caixu-data-mcp.get_latest_lifecycle_run",
  "caixu-data-mcp.write_package_run",
  "caixu-data-mcp.get_package_run",
  "caixu-data-mcp.get_submission_profile",
  "caixu-data-mcp.write_execution_log"
]);

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function skillText(skillDir: string): string {
  return read(`${skillDir}/SKILL.md`);
}

function requiredTools(text: string): string[] {
  const tools = Array.from(text.matchAll(/- `([^`]+)`/g)).map((match) => match[1]!);
  return tools.filter((tool) => tool.startsWith("caixu-"));
}

describe("skill robustness", () => {
  it("every skill keeps concise package-style structure in SKILL.md", () => {
    for (const skill of skills) {
      const text = skillText(skill);
      expect(text.startsWith("---\nname:")).toBe(true);
      expect(text).toContain("## Quick flow");
      expect(text).toContain("## Read next only when needed");
      expect(text).toContain("## Required tools");
      expect(text).toContain("## Workflow");
      expect(text).toContain("## Guardrails");
    }
  });

  it("every referenced tool exists in the current MCP surface", () => {
    for (const skill of skills) {
      const tools = requiredTools(skillText(skill));
      for (const tool of tools) {
        expect(validTools.has(tool), `${skill} references unknown tool ${tool}`).toBe(true);
      }
    }
  });

  it("submit-demo documents package id alias, dry_run, preflight, and browser logging expectations", () => {
    const skill = skillText("caixu-submit-demo");
    const contracts = read("caixu-submit-demo/references/tool-contracts.md");
    const failureModes = read("caixu-submit-demo/references/failure-modes.md");

    expect(skill).toContain("`package_plan_id` or `package_id`");
    expect(skill).toContain("`dry_run?`");
    expect(skill).toContain("AutoClaw/OpenClaw");
    expect(skill).toContain("scripts/preflight-submit.mjs");
    expect(contracts).toContain("`execution_log`");
    expect(failureModes).toContain("`failure_reason`");
  });

  it("check-lifecycle documents agent-main validation flow and audit boundaries", () => {
    const skill = skillText("caixu-check-lifecycle");
    const workflow = read("caixu-check-lifecycle/references/workflow.md");
    const contracts = read("caixu-check-lifecycle/references/tool-contracts.md");
    const failureModes = read("caixu-check-lifecycle/references/failure-modes.md");

    expect(skill).toContain("YYYY-MM-DD");
    expect(skill).toContain("scripts/validate-lifecycle-payload.mjs");
    expect(skill).toContain("write_lifecycle_run");
    expect(workflow).toContain("RuleProfileBundle");
    expect(contracts).toContain("`readiness` 是唯一正式“是否可提交”来源");
    expect(failureModes).toContain("schema 不完整");
  });

  it("build-asset-library preserves conservative extraction and merge constraints", () => {
    const skill = skillText("caixu-build-asset-library");
    const contracts = read("caixu-build-asset-library/references/tool-contracts.md");
    const failureModes = read("caixu-build-asset-library/references/failure-modes.md");

    expect(skill).toContain("`binary_only`");
    expect(skill).toContain("不合并");
    expect(contracts).toContain("`library_id + file_id`");
    expect(failureModes).toContain("不能直接生成 `asset_card`");
  });

  it("build-package points to shared docgen, readiness inheritance, and real output preflight", () => {
    const skill = skillText("caixu-build-package");
    const workflow = read("caixu-build-package/references/workflow.md");
    const failureModes = read("caixu-build-package/references/failure-modes.md");

    expect(skill).toContain("@caixu/docgen");
    expect(skill).toContain("`output_dir`");
    expect(skill).toContain("scripts/preflight-package-output.mjs");
    expect(workflow).toContain("Agent 不应决定");
    expect(failureModes).toContain("不能把 `ready_for_submission = false` 翻成 `true`");
  });

  it("maintain-asset-library keeps manual-maintenance boundaries and verification loop", () => {
    const skill = skillText("caixu-maintain-asset-library");
    const workflow = read("caixu-maintain-asset-library/references/workflow.md");
    const contracts = read("caixu-maintain-asset-library/references/tool-contracts.md");
    const failureModes = read("caixu-maintain-asset-library/references/failure-modes.md");

    expect(skill).toContain("`patch_asset_card`");
    expect(skill).toContain("`archive_asset`");
    expect(skill).toContain("`restore_asset`");
    expect(skill).toContain("`query_assets`");
    expect(workflow).toContain("默认一次只处理一条资产");
    expect(contracts).toContain("默认查询只消费 `active` 资产");
    expect(failureModes).toContain("不做物理删除");
  });

  it("query-assets keeps canonical mapping and empty-result boundaries in references", () => {
    const skill = skillText("caixu-query-assets");
    const workflow = read("caixu-query-assets/references/workflow.md");
    const failureModes = read("caixu-query-assets/references/failure-modes.md");

    expect(skill).toContain("有界查询");
    expect(workflow).toContain("`证明类` -> `proof`");
    expect(workflow).toContain("`实习申请` -> `summer_internship_application`");
    expect(failureModes).toContain("不伪造命中");
  });

  it("ingest-materials keeps persistence boundary and provider awareness", () => {
    const skill = skillText("caixu-ingest-materials");
    const contracts = read("caixu-ingest-materials/references/tool-contracts.md");
    const failureModes = read("caixu-ingest-materials/references/failure-modes.md");

    expect(skill).toContain("`data.library_id`");
    expect(skill).toContain("`caixu-ocr-mcp.list_local_files`");
    expect(skill).toContain("`caixu-ocr-mcp.extract_parser_text`");
    expect(skill).toContain("`caixu-ocr-mcp.extract_visual_text`");
    expect(skill).toContain("`caixu-data-mcp.create_pipeline_run`");
    expect(contracts).toContain("`zhipu_parser_lite`");
    expect(contracts).toContain("`skip`");
    expect(failureModes).toContain("不要声称材料已经进入库");
  });
});
