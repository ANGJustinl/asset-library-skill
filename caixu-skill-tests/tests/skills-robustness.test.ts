import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot, skillSpecs } from "../../scripts/lib/skill-specs.mjs";

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
  "caixu-data-mcp.query_assets_vector",
  "caixu-data-mcp.reindex_library_search",
  "caixu-data-mcp.get_rule_profile",
  "caixu-data-mcp.write_lifecycle_run",
  "caixu-data-mcp.get_latest_lifecycle_run",
  "caixu-data-mcp.write_package_run",
  "caixu-data-mcp.get_package_run",
  "caixu-data-mcp.get_submission_profile",
  "caixu-data-mcp.write_execution_log"
]);

function read(pathname: string): string {
  return readFileSync(pathname, "utf8");
}

function skillText(skillName: string): string {
  const skill = skillSpecs.find((spec) => spec.skillName === skillName);
  if (!skill) {
    throw new Error(`Unknown skill ${skillName}`);
  }
  return read(skill.skillFile);
}

function requiredTools(text: string): string[] {
  const tools = Array.from(text.matchAll(/- `([^`]+)`/g)).map((match) => match[1]!);
  return tools.filter(
    (tool) => tool.startsWith("caixu-data-mcp.") || tool.startsWith("caixu-ocr-mcp.")
  );
}

describe("skill robustness", () => {
  it("every skill keeps concise package-style structure in SKILL.md", () => {
    for (const skill of skillSpecs) {
      const text = skillText(skill.skillName);
      expect(text.startsWith("---\nname:")).toBe(true);
      expect(text).toContain("## Quick flow");
      expect(text).toContain("## Read next only when needed");
      expect(text).toContain("## Required tools");
      expect(text).toContain("## Workflow");
      expect(text).toContain("## Guardrails");
    }
  });

  it("every referenced tool exists in the current MCP surface", () => {
    for (const skill of skillSpecs) {
      const tools = requiredTools(skillText(skill.skillName));
      for (const tool of tools) {
        expect(validTools.has(tool), `${skill.skillName} references unknown tool ${tool}`).toBe(
          true
        );
      }
    }
  });

  it("caixu-skill stays a route-only main entry without direct MCP execution", () => {
    const skill = skillText("caixu-skill");
    const workflow = read(join(repoRoot, "references", "workflow.md"));
    const contracts = read(join(repoRoot, "references", "tool-contracts.md"));
    const failureModes = read(join(repoRoot, "references", "failure-modes.md"));

    expect(skill).toContain("不直接调用 MCP tools");
    expect(skill).toContain("next_recommended_skill");
    expect(workflow).toContain("Routing order");
    expect(contracts).toContain("Child skill routes");
    expect(failureModes).toContain("raw materials 请求缺少具体本地路径");
  });

  it("submit-demo documents package id alias, dry_run, preflight, and browser logging expectations", () => {
    const skill = skillText("caixu-submit-demo");
    const contracts = read(join(repoRoot, "caixu-submit-demo", "references", "tool-contracts.md"));
    const failureModes = read(
      join(repoRoot, "caixu-submit-demo", "references", "failure-modes.md")
    );

    expect(skill).toContain("`package_plan_id` or `package_id`");
    expect(skill).toContain("`dry_run?`");
    expect(skill).toContain("AutoClaw/OpenClaw");
    expect(skill).toContain("scripts/preflight-submit.mjs");
    expect(contracts).toContain("`execution_log`");
    expect(failureModes).toContain("`failure_reason`");
  });

  it("check-lifecycle documents agent-main validation flow and audit boundaries", () => {
    const skill = skillText("caixu-check-lifecycle");
    const workflow = read(join(repoRoot, "caixu-check-lifecycle", "references", "workflow.md"));
    const contracts = read(
      join(repoRoot, "caixu-check-lifecycle", "references", "tool-contracts.md")
    );
    const failureModes = read(
      join(repoRoot, "caixu-check-lifecycle", "references", "failure-modes.md")
    );

    expect(skill).toContain("YYYY-MM-DD");
    expect(skill).toContain("scripts/validate-lifecycle-payload.mjs");
    expect(skill).toContain("write_lifecycle_run");
    expect(workflow).toContain("RuleProfileBundle");
    expect(contracts).toContain("`readiness` 是唯一正式“是否可提交”来源");
    expect(failureModes).toContain("schema 不完整");
  });

  it("build-asset-library preserves conservative extraction and merge constraints", () => {
    const skill = skillText("caixu-build-asset-library");
    const workflow = read(join(repoRoot, "caixu-build-asset-library", "references", "workflow.md"));
    const contracts = read(
      join(repoRoot, "caixu-build-asset-library", "references", "tool-contracts.md")
    );
    const failureModes = read(
      join(repoRoot, "caixu-build-asset-library", "references", "failure-modes.md")
    );

    expect(skill).toContain("`caixu-data-mcp.create_pipeline_run`");
    expect(skill).toContain("`caixu-data-mcp.complete_pipeline_run`");
    expect(skill).toContain("`binary_only`");
    expect(skill).toContain("不合并");
    expect(workflow).toContain("`create_pipeline_run`");
    expect(workflow).toContain("`complete_pipeline_run`");
    expect(contracts).toContain("`library_id + file_id`");
    expect(failureModes).toContain("不能直接生成 `asset_card`");
  });

  it("build-package points to shared docgen, readiness inheritance, and real output preflight", () => {
    const skill = skillText("caixu-build-package");
    const workflow = read(join(repoRoot, "caixu-build-package", "references", "workflow.md"));
    const failureModes = read(
      join(repoRoot, "caixu-build-package", "references", "failure-modes.md")
    );

    expect(skill).toContain("@caixu/docgen");
    expect(skill).toContain("`output_dir`");
    expect(skill).toContain("scripts/preflight-package-output.mjs");
    expect(workflow).toContain("Agent 不应决定");
    expect(failureModes).toContain("不能把 `ready_for_submission = false` 翻成 `true`");
  });

  it("maintain-asset-library keeps manual-maintenance boundaries and verification loop", () => {
    const skill = skillText("caixu-maintain-asset-library");
    const workflow = read(
      join(repoRoot, "caixu-maintain-asset-library", "references", "workflow.md")
    );
    const contracts = read(
      join(repoRoot, "caixu-maintain-asset-library", "references", "tool-contracts.md")
    );
    const failureModes = read(
      join(repoRoot, "caixu-maintain-asset-library", "references", "failure-modes.md")
    );

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
    const workflow = read(join(repoRoot, "caixu-query-assets", "references", "workflow.md"));
    const failureModes = read(
      join(repoRoot, "caixu-query-assets", "references", "failure-modes.md")
    );

    expect(skill).toContain("有界查询");
    expect(workflow).toContain("`证明类` -> `proof`");
    expect(workflow).toContain('`tag_filters_any += ["use:summer_internship_application"]`');
    expect(workflow).toContain("`reindex_library_search`");
    expect(failureModes).toContain("不伪造命中");
  });

  it("ingest-materials keeps persistence boundary and provider awareness", () => {
    const skill = skillText("caixu-ingest-materials");
    const contracts = read(
      join(repoRoot, "caixu-ingest-materials", "references", "tool-contracts.md")
    );
    const failureModes = read(
      join(repoRoot, "caixu-ingest-materials", "references", "failure-modes.md")
    );

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
