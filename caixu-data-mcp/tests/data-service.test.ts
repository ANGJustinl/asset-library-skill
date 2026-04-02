import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentDecisionAudit,
  AssetCard,
  CheckLifecycleData,
  PackagePlan,
  ParsedFile
} from "@caixu/contracts";
import { createDataService } from "../src/service.js";
import type { SearchEmbedder } from "../src/search-embedder.js";

const services: Array<ReturnType<typeof createDataService>> = [];

const fakeEmbedder: SearchEmbedder = {
  modelId: "fake-multilingual-minilm",
  dimensions: 384,
  embedTexts(texts) {
    return texts.map((text) => {
      const base = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 997;
      return Array.from({ length: 384 }, (_, index) => ((base + index) % 101) / 100);
    });
  }
};

function makeService() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "caixu-data-mcp-")), "caixu.sqlite");
  const service = createDataService(dbPath, { searchEmbedder: fakeEmbedder });
  services.push(service);
  return service;
}

afterEach(() => {
  while (services.length) {
    services.pop()?.close();
  }
});

describe("@caixu/data-mcp", () => {
  it("creates a library and stores parsed files", () => {
    const service = makeService();
    const library = service.createOrLoadLibrary({ owner_hint: "demo_student" });
    const libraryId = library.data?.library_id;

    expect(libraryId).toBeTruthy();

    const parsedFiles: ParsedFile[] = [
      {
        file_id: "file_001",
        file_name: "transcript.txt",
        file_path: "/tmp/transcript.txt",
        mime_type: "text/plain",
        size_bytes: 10,
        parse_status: "parsed",
        extracted_text: "Transcript",
        extracted_summary: "Transcript",
        provider: "local"
      }
    ];

    const stored = service.upsertParsedFiles({
      library_id: libraryId!,
      parsed_files: parsedFiles
    });

    expect(stored.data?.file_ids).toEqual(["file_001"]);
  });

  it("stores and queries assets and profiles", () => {
    const service = makeService();
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;

    const assetCards: AssetCard[] = [
      {
        schema_version: "1.0",
        library_id: libraryId,
        asset_id: "asset_transcript_001",
        material_type: "proof",
        title: "Official Transcript",
        holder_name: "Demo Student",
        issuer_name: "Demo University",
        issue_date: "2026-03-01",
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
            file_id: "file_001",
            file_name: "transcript.txt",
            mime_type: "text/plain"
          }
        ],
        confidence: 0.98,
        normalized_summary: "Transcript for internship.",
        asset_state: "active",
        review_status: "auto",
        last_verified_at: null
      }
    ];

    service.upsertAssetCards({ library_id: libraryId, asset_cards: assetCards });
    const query = service.queryAssets({ library_id: libraryId, keyword: "Transcript" });
    const semanticQuery = service.queryAssets({
      library_id: libraryId,
      semantic_query: "暑期实习申请要用的成绩单证明",
      tag_filters_any: ["use:summer_internship_application"]
    });
    const ruleProfile = service.getRuleProfile({
      profile_id: "summer_internship_application"
    });
    const submissionProfile = service.getSubmissionProfile({
      profile_id: "judge_demo_v1"
    });

    expect(query.data?.asset_cards).toHaveLength(1);
    expect(semanticQuery.data?.asset_cards).toHaveLength(1);
    expect(ruleProfile.data?.profile.bundle_version).toBe("2026.03");
    expect(submissionProfile.data?.profile.profile_id).toBe("judge_demo_v1");
  });

  it("keeps default queryAssets on FTS plus tags without calling the embedder", () => {
    let embedCalls = 0;
    const countingEmbedder: SearchEmbedder = {
      modelId: "counting-embedder",
      dimensions: 384,
      embedTexts(texts) {
        embedCalls += 1;
        return texts.map((text) => {
          const base = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 997;
          return Array.from({ length: 384 }, (_, index) => ((base + index) % 101) / 100);
        });
      }
    };

    const dbPath = join(mkdtempSync(join(tmpdir(), "caixu-data-mcp-")), "caixu.sqlite");
    const service = createDataService(dbPath, { searchEmbedder: countingEmbedder });
    services.push(service);
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;

    service.upsertAssetCards({
      library_id: libraryId,
      asset_cards: [
        {
          schema_version: "1.0",
          library_id: libraryId,
          asset_id: "asset_resume_001",
          material_type: "experience",
          title: "个人简历",
          holder_name: "Demo Student",
          issuer_name: null,
          issue_date: null,
          expiry_date: null,
          validity_status: "unknown",
          agent_tags: [
            "doc:resume",
            "entity:project_experience",
            "use:general_reference",
            "risk:auto"
          ],
          reusable_scenarios: [],
          sensitivity_level: "medium",
          source_files: [
            {
              file_id: "file_resume_001",
              file_name: "resume.pdf",
              mime_type: "application/pdf"
            }
          ],
          confidence: 0.9,
          normalized_summary: "个人简历，包含教育背景与项目经历。",
          asset_state: "active",
          review_status: "auto",
          last_verified_at: null
        }
      ]
    });

    embedCalls = 0;
    const exactEnough = service.queryAssets({
      library_id: libraryId,
      semantic_query: "找我的简历",
      tag_filters_any: ["doc:resume"],
      material_types: ["experience"],
      limit: 1
    });

    expect(exactEnough.status).toBe("success");
    expect(exactEnough.data?.asset_cards).toHaveLength(1);
    expect(embedCalls).toBe(0);
  });

  it("uses queryAssetsVector only when semantic vector search is explicitly requested", () => {
    let embedCalls = 0;
    const countingEmbedder: SearchEmbedder = {
      modelId: "counting-embedder",
      dimensions: 384,
      embedTexts(texts) {
        embedCalls += 1;
        return texts.map((text) => {
          const base = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 997;
          return Array.from({ length: 384 }, (_, index) => ((base + index) % 101) / 100);
        });
      }
    };

    const dbPath = join(mkdtempSync(join(tmpdir(), "caixu-data-mcp-")), "caixu.sqlite");
    const service = createDataService(dbPath, { searchEmbedder: countingEmbedder });
    services.push(service);
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;

    service.upsertAssetCards({
      library_id: libraryId,
      asset_cards: [
        {
          schema_version: "1.0",
          library_id: libraryId,
          asset_id: "asset_resume_001",
          material_type: "experience",
          title: "个人简历",
          holder_name: "Demo Student",
          issuer_name: null,
          issue_date: null,
          expiry_date: null,
          validity_status: "unknown",
          agent_tags: [
            "doc:resume",
            "entity:project_experience",
            "use:job_application",
            "risk:auto"
          ],
          reusable_scenarios: ["job_application"],
          sensitivity_level: "medium",
          source_files: [
            {
              file_id: "file_resume_001",
              file_name: "resume.pdf",
              mime_type: "application/pdf"
            }
          ],
          confidence: 0.9,
          normalized_summary: "个人简历，包含教育背景与项目经历。",
          asset_state: "active",
          review_status: "auto",
          last_verified_at: null
        }
      ]
    });

    embedCalls = 0;
    const vectorResult = service.queryAssetsVector({
      library_id: libraryId,
      semantic_query: "查找与个人简历最相关的材料",
      tag_filters_any: ["doc:resume"],
      material_types: ["experience"],
      limit: 1
    });

    expect(vectorResult.status).toBe("success");
    expect(vectorResult.data?.asset_cards).toHaveLength(1);
    expect(embedCalls).toBe(1);
  });

  it("exposes maintenance tools for overview, patch, archive, restore, and review queue", () => {
    const service = makeService();
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;

    service.upsertAssetCards({
      library_id: libraryId,
      asset_cards: [
        {
          schema_version: "1.0",
          library_id: libraryId,
          asset_id: "asset_resume_001",
          material_type: "experience",
          title: "个人简历",
          holder_name: "Demo Student",
          issuer_name: null,
          issue_date: null,
          expiry_date: null,
          validity_status: "unknown",
          agent_tags: [
            "doc:resume",
            "entity:experience_record",
            "use:job_application",
            "risk:needs_review"
          ],
          reusable_scenarios: [],
          sensitivity_level: "medium",
          source_files: [
            {
              file_id: "file_resume_001",
              file_name: "resume.pdf",
              mime_type: "application/pdf"
            }
          ],
          confidence: 0.62,
          normalized_summary: "Demo Student 的个人简历。",
          asset_state: "active",
          review_status: "needs_review",
          last_verified_at: null
        }
      ]
    });

    const libraries = service.listLibraries();
    const overview = service.getLibraryOverview({ library_id: libraryId });
    const reviewQueue = service.listReviewQueue({ library_id: libraryId });
    const patched = service.patchAssetCard({
      library_id: libraryId,
      asset_id: "asset_resume_001",
      patch: {
        normalized_summary: "Demo Student 的个人简历，已人工确认。"
      }
    });
    const archived = service.archiveAsset({
      library_id: libraryId,
      asset_id: "asset_resume_001"
    });
    const activeQuery = service.queryAssets({ library_id: libraryId });
    const restored = service.restoreAsset({
      library_id: libraryId,
      asset_id: "asset_resume_001"
    });
    const reindexed = service.reindexLibrarySearch({ library_id: libraryId });

    expect(libraries.data?.libraries).toHaveLength(1);
    expect(overview.data?.counts.needs_review_assets).toBe(1);
    expect(reviewQueue.data?.asset_cards).toHaveLength(1);
    expect(patched.data?.asset_card.review_status).toBe("reviewed");
    expect(archived.data?.asset_card.asset_state).toBe("archived");
    expect(activeQuery.data?.asset_cards).toHaveLength(0);
    expect(restored.data?.asset_card.asset_state).toBe("active");
    expect(reindexed.data?.indexed_assets).toBeGreaterThan(0);
  });

  it("fails for unsupported rule profiles", () => {
    const service = makeService();
    const result = service.getRuleProfile({ profile_id: "unknown_goal" });

    expect(result.status).toBe("failed");
    expect(result.errors?.[0]?.code).toBe("RULE_PROFILE_NOT_SUPPORTED");
  });

  it("fails for unsupported submission profiles", () => {
    const service = makeService();
    const result = service.getSubmissionProfile({ profile_id: "unknown_submitter" });

    expect(result.status).toBe("failed");
    expect(result.errors?.[0]?.code).toBe("SUBMISSION_PROFILE_NOT_SUPPORTED");
  });

  it("reads back the latest lifecycle run", () => {
    const service = makeService();
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;
    const payload: CheckLifecycleData = {
      library_id: libraryId,
      as_of_date: "2026-03-29",
      window_days: 60,
      lifecycle_events: [],
      rule_matches: [],
      missing_items: {
        schema_version: "1.0",
        library_id: libraryId,
        diagnosis_id: "diag_001",
        target_goal: "summer_internship_application",
        rule_pack_id: "cn.student.internship.v1",
        items: [],
        available_asset_ids: [],
        gap_summary: "No gap",
        next_actions: [],
        blocking_level: "none"
      },
      readiness: {
        ready_for_submission: true,
        blocking_items: [],
        warning_items: [],
        rationale: "Ready"
      }
    };

    const audit: AgentDecisionAudit = {
      decision_id: "decision_001",
      stage: "check_lifecycle",
      library_id: libraryId,
      goal: "summer_internship_application",
      profile_id: "summer_internship_application",
      model: "glm-4.6",
      input_asset_ids: [],
      input_file_ids: [],
      input_summary: "Lifecycle audit",
      validation_status: "passed",
      validation_errors: [],
      result_hash: "a".repeat(40),
      created_at: "2026-03-29T00:00:00.000Z"
    };

    service.writeLifecycleRun({
      run_id: "run_001",
      goal: "summer_internship_application",
      payload,
      audit
    });

    const result = service.getLatestLifecycleRun({
      library_id: libraryId,
      goal: "summer_internship_application"
    });

    expect(result.status).toBe("success");
    expect(result.data?.lifecycle_run?.library_id).toBe(libraryId);
    expect(result.data?.audit?.decision_id).toBe("decision_001");
  });

  it("writes package runs with audit sidecars", () => {
    const service = makeService();
    const libraryId = service.createOrLoadLibrary({ owner_hint: "demo_student" }).data!
      .library_id;
    const packagePlan: PackagePlan = {
      schema_version: "1.0",
      library_id: libraryId,
      package_id: "pkg_001",
      target_goal: "summer_internship_application",
      package_name: "summer-internship-application-package",
      selected_asset_ids: [],
      selected_exports: [
        "personal-material-assets.xlsx",
        "renewal-checklist-60d.xlsx",
        "summer-internship-application-package.zip"
      ],
      missing_items_ref: "diag_001",
      generated_files: [
        {
          file_name: "personal-material-assets.xlsx",
          file_type: "xlsx",
          purpose: "Asset ledger export"
        },
        {
          file_name: "renewal-checklist-60d.xlsx",
          file_type: "xlsx",
          purpose: "60-day renewal checklist"
        },
        {
          file_name: "summer-internship-application-package.zip",
          file_type: "zip",
          purpose: "Submission package bundle"
        }
      ],
      submission_profile: "judge_demo_v1",
      readiness: {
        ready_for_submission: false,
        blocking_items: [],
        warning_items: [],
        rationale: "Truthful package only."
      },
      operator_notes: "Package audit"
    };
    const audit: AgentDecisionAudit = {
      decision_id: "decision_002",
      stage: "build_package",
      library_id: libraryId,
      goal: "summer_internship_application",
      profile_id: "summer_internship_application",
      model: "glm-4.6",
      input_asset_ids: [],
      input_file_ids: [],
      input_summary: "Package audit",
      validation_status: "passed",
      validation_errors: [],
      result_hash: "b".repeat(40),
      created_at: "2026-03-29T00:00:01.000Z"
    };

    const writeResult = service.writePackageRun({
      package_plan: packagePlan,
      output_dir: "/tmp/pkg",
      audit
    });
    const readResult = service.getPackageRun({ package_id: "pkg_001" });

    expect(writeResult.status).toBe("success");
    expect(readResult.data?.package_plan?.package_id).toBe("pkg_001");
    expect(readResult.data?.audit?.decision_id).toBe("decision_002");
  });
});
