import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildPackage, exportLedgers } from "../caixu-shared-core/packages/docgen/dist/src/index.js";
import { getRuleProfileBundle } from "../caixu-shared-core/packages/rules/dist/src/index.js";
import {
  createMockSkillModelClient,
  runBuildAssetLibrarySkill,
  runBuildPackageSkill,
  runCheckLifecycleSkill
} from "../caixu-shared-core/packages/skill-runner/dist/src/index.js";
import { createDataService } from "../caixu-data-mcp/dist/src/service.js";

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const fixtureDir = join(repoRoot, "fixtures", "materials");

function parsedFile(fileName) {
  const filePath = join(fixtureDir, fileName);
  const text = readFileSync(filePath, "utf8");
  return {
    file_id: `file_${fileName.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    file_name: fileName,
    file_path: filePath,
    mime_type: "text/plain",
    size_bytes: statSync(filePath).size,
    parse_status: "parsed",
    extracted_text: text,
    extracted_summary: text.replace(/\s+/g, " ").trim(),
    provider: "local"
  };
}

function mockSkillModelClient(libraryId, profile) {
  return createMockSkillModelClient(async ({ taskTitle, userPrompt }) => {
    if (taskTitle.includes("Decide which parsed files should enter the asset library")) {
      return {
        model: "mock-build-asset",
        content: JSON.stringify({
          decisions: [
            {
              file_id: "file_transcript_txt",
              include_in_library: true,
              document_role: "proof",
              reason: null
            },
            {
              file_id: "file_student_status_certificate_txt",
              include_in_library: true,
              document_role: "proof",
              reason: null
            },
            {
              file_id: "file_cet6_score_report_txt",
              include_in_library: true,
              document_role: "proof",
              reason: null
            }
          ]
        })
      };
    }

    if (taskTitle.includes("Extract canonical asset_cards for triaged files")) {
      return {
        model: "mock-build-asset",
        content: JSON.stringify({
          decisions: [
            {
              file_id: "file_transcript_txt",
              asset_card: {
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
                reusable_scenarios: ["summer_internship_application"],
                sensitivity_level: "medium",
                source_files: [
                  {
                    file_id: "file_transcript_txt",
                    file_name: "transcript.txt",
                    mime_type: "text/plain",
                    file_path: join(fixtureDir, "transcript.txt")
                  }
                ],
                confidence: 0.98,
                normalized_summary: "Official transcript for internship applications."
              },
              skip_reason: null
            },
            {
              file_id: "file_student_status_certificate_txt",
              asset_card: {
                schema_version: "1.0",
                library_id: libraryId,
                asset_id: "asset_student_status_001",
                material_type: "proof",
                title: "Current Student Status Certificate",
                holder_name: "Demo Student",
                issuer_name: "Demo University Academic Affairs Office",
                issue_date: "2026-03-15",
                expiry_date: "2026-04-20",
                validity_status: "expiring",
                reusable_scenarios: ["summer_internship_application"],
                sensitivity_level: "medium",
                source_files: [
                  {
                    file_id: "file_student_status_certificate_txt",
                    file_name: "student-status-certificate.txt",
                    mime_type: "text/plain",
                    file_path: join(fixtureDir, "student-status-certificate.txt")
                  }
                ],
                confidence: 0.97,
                normalized_summary: "Current student status certificate for internship applications."
              },
              skip_reason: null
            },
            {
              file_id: "file_cet6_score_report_txt",
              asset_card: {
                schema_version: "1.0",
                library_id: libraryId,
                asset_id: "asset_language_001",
                material_type: "proof",
                title: "CET-6 Score Report",
                holder_name: "Demo Student",
                issuer_name: "National College English Testing Committee",
                issue_date: "2025-12-20",
                expiry_date: null,
                validity_status: "long_term",
                reusable_scenarios: ["summer_internship_application"],
                sensitivity_level: "medium",
                source_files: [
                  {
                    file_id: "file_cet6_score_report_txt",
                    file_name: "cet6-score-report.txt",
                    mime_type: "text/plain",
                    file_path: join(fixtureDir, "cet6-score-report.txt")
                  }
                ],
                confidence: 0.96,
                normalized_summary: "CET-6 English proficiency certificate."
              },
              skip_reason: null
            }
          ]
        })
      };
    }

    if (taskTitle.includes("Conservatively merge obvious duplicate versions")) {
      return {
        model: "mock-build-asset",
        content: JSON.stringify({ merged_assets: [] })
      };
    }

    if (taskTitle.includes("Produce a complete CheckLifecycleData decision")) {
      return {
        model: "mock-lifecycle",
        content: JSON.stringify({
          library_id: libraryId,
          as_of_date: "2026-03-29",
          window_days: 60,
          lifecycle_events: [
            {
              schema_version: "1.0",
              library_id: libraryId,
              event_id: "evt_student_status_renewal_001",
              asset_id: "asset_student_status_001",
              trigger_type: "renewal_window_trigger",
              event_status: "recommended",
              severity: "warning",
              event_date: "2026-03-29",
              window_start_date: "2026-03-29",
              window_end_date: "2026-04-20",
              target_goal: "summer_internship_application",
              recommended_action: "在到期前补办新的在读证明。",
              prerequisite_assets: ["proof:student_status_certificate"],
              blocking_items: [],
              related_rule_ids: ["req_student_status"]
            }
          ],
          rule_matches: [
            {
              schema_version: "1.0",
              library_id: libraryId,
              match_id: "match_transcript_001",
              asset_id: "asset_transcript_001",
              rule_pack_id: profile.rule_pack_id,
              rule_id: "req_transcript",
              scene_key: "summer_internship_application",
              match_status: "matched",
              renewable: false,
              reusable: true,
              required_assets: ["proof:transcript"],
              output_requirements: ["transcript"],
              notes: "成绩单可直接复用。"
            },
            {
              schema_version: "1.0",
              library_id: libraryId,
              match_id: "match_student_status_001",
              asset_id: "asset_student_status_001",
              rule_pack_id: profile.rule_pack_id,
              rule_id: "req_student_status",
              scene_key: "summer_internship_application",
              match_status: "matched",
              renewable: true,
              reusable: true,
              required_assets: ["proof:student_status_certificate"],
              output_requirements: ["student_status_certificate"],
              notes: "在读证明可复用，但已进入续办窗口。"
            },
            {
              schema_version: "1.0",
              library_id: libraryId,
              match_id: "match_language_001",
              asset_id: "asset_language_001",
              rule_pack_id: profile.rule_pack_id,
              rule_id: "req_language_certificate",
              scene_key: "summer_internship_application",
              match_status: "recommended",
              renewable: false,
              reusable: true,
              required_assets: ["proof:language_certificate"],
              output_requirements: ["language_certificate"],
              notes: "语言证明推荐附带。"
            }
          ],
          missing_items: {
            schema_version: "1.0",
            library_id: libraryId,
            diagnosis_id: "diag_internship_001",
            target_goal: "summer_internship_application",
            rule_pack_id: profile.rule_pack_id,
            items: [
              {
                code: "proof:id_card_copy",
                title: "身份证明复印件",
                description: "当前资产库中缺少身份证明复印件。",
                severity: "blocking",
                asset_type: "proof",
                required_for: "summer_internship_application",
                suggested_action: "补充身份证复印件或护照首页。"
              }
            ],
            available_asset_ids: [
              "asset_transcript_001",
              "asset_student_status_001",
              "asset_language_001"
            ],
            gap_summary: "缺少身份证明复印件，当前不应直接提交。",
            next_actions: ["补充身份证明复印件", "生成 truthful package 供人工检查"],
            blocking_level: "blocking"
          },
          readiness: {
            ready_for_submission: false,
            blocking_items: [
              {
                code: "proof:id_card_copy",
                title: "身份证明复印件",
                description: "当前资产库中缺少身份证明复印件。",
                severity: "blocking",
                asset_type: "proof",
                required_for: "summer_internship_application",
                suggested_action: "补充身份证复印件或护照首页。"
              }
            ],
            warning_items: [],
            rationale: "缺少身份证明复印件，不能直接提交，但可以先导出 truthful package。"
          }
        })
      };
    }

    if (taskTitle.includes("Select assets and produce a truthful PackagePlan")) {
      return {
        model: "mock-package",
        content: JSON.stringify({
          schema_version: "1.0",
          library_id: libraryId,
          package_id: "pkg_001",
          target_goal: "summer_internship_application",
          package_name: "summer-internship-application-package",
          selected_asset_ids: [
            "asset_transcript_001",
            "asset_student_status_001",
            "asset_language_001"
          ],
          selected_exports: [
            "personal-material-assets.xlsx",
            "renewal-checklist-60d.xlsx",
            "summer-internship-application-package.zip"
          ],
          missing_items_ref: "diag_internship_001",
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
            blocking_items: [
              {
                code: "proof:id_card_copy",
                title: "身份证明复印件",
                description: "当前资产库中缺少身份证明复印件。",
                severity: "blocking",
                asset_type: "proof",
                required_for: "summer_internship_application",
                suggested_action: "补充身份证复印件或护照首页。"
              }
            ],
            warning_items: [],
            rationale: "缺少身份证明复印件，不能直接提交，但可以先导出 truthful package。"
          },
          operator_notes: "缺身份证明，先导出 truthful package。"
        })
      };
    }

    throw new Error(`Unhandled mock skill prompt: ${taskTitle}\n${userPrompt}`);
  });
}

async function main() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "caixu-agent-smoke-db-")), "caixu.sqlite");
  const outputDir = mkdtempSync(join(tmpdir(), "caixu-agent-smoke-out-"));
  const service = createDataService(dbPath);

  try {
    const libraryResult = service.createOrLoadLibrary({
      library_id: "lib_demo_student_001",
      owner_hint: "demo_student"
    });
    invariant(libraryResult.status === "success", "failed to create library");
    const libraryId = libraryResult.data?.library_id;
    invariant(libraryId, "missing library_id");

    const transcriptFile = parsedFile("transcript.txt");
    const studentStatusFile = parsedFile("student-status-certificate.txt");
    const cet6File = parsedFile("cet6-score-report.txt");
    const parsedFiles = [transcriptFile, studentStatusFile, cet6File];

    const persistFiles = service.upsertParsedFiles({
      library_id: libraryId,
      parsed_files: parsedFiles
    });
    invariant(persistFiles.status === "success", "failed to persist parsed files");

    const profile = getRuleProfileBundle("summer_internship_application");
    const modelClient = mockSkillModelClient(libraryId, profile);

    const buildResult = await runBuildAssetLibrarySkill({
      skillDir: join(repoRoot, "caixu-build-asset-library"),
      library_id: libraryId,
      parsed_files: parsedFiles,
      modelClient
    });
    invariant(buildResult.status === "success", "build-asset-library skill failed");
    const assets = buildResult.data?.asset_cards ?? [];
    invariant(assets.length === 3, "expected 3 extracted assets");
    invariant(
      service.upsertAssetCards({ library_id: libraryId, asset_cards: assets }).status ===
        "success",
      "failed to persist asset cards"
    );
    invariant(
      service.upsertMergedAssets({
        library_id: libraryId,
        merged_assets: buildResult.data?.merged_assets ?? []
      }).status === "success",
      "failed to persist merged assets"
    );
    invariant(
      service.writeAgentDecisionAudit({
        audit: buildResult.audit,
        run_ref_type: "asset_library_build",
        run_ref_id: `asset_build_${libraryId}`
      }).status === "success",
      "failed to persist build audit"
    );

    const lifecycleDecision = await runCheckLifecycleSkill({
      skillDir: join(repoRoot, "caixu-check-lifecycle"),
      library_id: libraryId,
      goal: "summer_internship_application",
      as_of_date: "2026-03-29",
      window_days: 60,
      profile,
      assets,
      modelClient
    });
    invariant(lifecycleDecision.status === "success", "check-lifecycle skill failed");
    invariant(
      lifecycleDecision.data?.readiness.ready_for_submission === false,
      "readiness should remain blocked"
    );

    const lifecycleRun = service.writeLifecycleRun({
      run_id: "run_internship_001",
      goal: "summer_internship_application",
      payload: lifecycleDecision.data,
      audit: lifecycleDecision.audit
    });
    invariant(lifecycleRun.status === "success", "failed to write lifecycle run");

    const ledgers = await exportLedgers({
      library_id: libraryId,
      output_dir: outputDir,
      assets,
      lifecycle: lifecycleDecision.data,
      as_of_date: lifecycleDecision.data.as_of_date,
      window_days: lifecycleDecision.data.window_days
    });

    const packageDecision = await runBuildPackageSkill({
      skillDir: join(repoRoot, "caixu-build-package"),
      library_id: libraryId,
      goal: "summer_internship_application",
      submission_profile: "judge_demo_v1",
      missing_items_ref: lifecycleDecision.data.missing_items.diagnosis_id,
      readiness: lifecycleDecision.data.readiness,
      profile,
      assets,
      modelClient
    });
    invariant(packageDecision.status === "success", "build-package skill failed");

    const packageBuild = await buildPackage({
      library_id: libraryId,
      goal: "summer_internship_application",
      output_dir: outputDir,
      assets,
      parsed_files: parsedFiles,
      package_id: packageDecision.data.package_id,
      package_name: packageDecision.data.package_name,
      selected_asset_ids: packageDecision.data.selected_asset_ids,
      selected_exports: packageDecision.data.selected_exports,
      generated_files: packageDecision.data.generated_files,
      readiness: packageDecision.data.readiness,
      missing_items_ref: packageDecision.data.missing_items_ref,
      submission_profile: packageDecision.data.submission_profile,
      operator_notes: packageDecision.data.operator_notes,
      allow_truthful_package_when_blocked: true
    });

    invariant(
      packageBuild.package_plan.package_id === packageDecision.data.package_id,
      "docgen package_id diverged from agent decision"
    );

    const packageRun = service.writePackageRun({
      package_plan: packageBuild.package_plan,
      output_dir: outputDir,
      audit: packageDecision.audit
    });
    invariant(packageRun.status === "success", "failed to write package run");

    const zipPath = packageBuild.exported_files[0];
    const zipListing = execFileSync("unzip", ["-Z1", zipPath], {
      encoding: "utf8"
    });

    invariant(zipListing.includes("materials/transcript.txt"), "zip missing transcript");
    invariant(
      zipListing.includes("materials/student-status-certificate.txt"),
      "zip missing student status certificate"
    );
    invariant(zipListing.includes("materials/cet6-score-report.txt"), "zip missing CET6");

    console.log(
      JSON.stringify(
        {
          status: "success",
          library_id: libraryId,
          readiness: lifecycleDecision.data.readiness,
          exported_ledgers: ledgers.exported_files,
          package_zip: zipPath,
          output_dir: outputDir,
          submission_blocked_before_browser: true
        },
        null,
        2
      )
    );
  } finally {
    service.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
