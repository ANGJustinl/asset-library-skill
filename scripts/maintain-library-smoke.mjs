#!/usr/bin/env node

import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openCaixuStorage } from "../caixu-shared-core/packages/storage/dist/src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createFixtureLibrary(storage) {
  const libraryId = storage.createOrLoadLibrary(undefined, "demo_student").library_id;
  if (!libraryId) {
    throw new Error("Failed to create fixture library.");
  }

  storage.upsertAssetCards(libraryId, [
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
      },
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
          "use:job_application",
          "risk:auto"
        ],
        reusable_scenarios: ["job_application"],
        sensitivity_level: "medium",
        source_files: [
          {
            file_id: "file_transcript_001",
            file_name: "transcript.pdf",
            mime_type: "application/pdf"
          }
        ],
        confidence: 0.95,
        normalized_summary: "Official transcript.",
        asset_state: "active",
        review_status: "auto",
        last_verified_at: null
      }
    ]);

  return libraryId;
}

function main() {
  const sourceDbPath = process.argv[2] ? resolve(process.argv[2]) : "";
  const requestedLibraryId = process.argv[3] ?? "";
  const runRoot = makeTempDir("caixu-maintain-library-");
  const dbPath = join(runRoot, "caixu.sqlite");

  if (sourceDbPath) {
    if (!existsSync(sourceDbPath)) {
      fail(`Source database does not exist: ${sourceDbPath}`);
    }
    cpSync(sourceDbPath, dbPath);
  }

  const storage = openCaixuStorage(sourceDbPath ? dbPath : dbPath);

  try {
    const libraryId =
      requestedLibraryId ||
      (sourceDbPath
        ? storage.listLibraries().libraries[0]?.library_id
        : createFixtureLibrary(storage));

    if (!libraryId) {
      fail("No library available for maintenance smoke.");
    }

    const beforeOverview = storage.getLibraryOverview(libraryId);
    const reviewQueue = storage.listReviewQueue(libraryId);
    const activeAssetsBeforePatch = storage.queryAssets({ library_id: libraryId }).asset_cards;
    const targetPatchAsset = reviewQueue.asset_cards[0] ?? activeAssetsBeforePatch[0];
    if (!targetPatchAsset) {
      fail("No active asset available to patch.");
    }

    const patchResult = storage.patchAssetCard(libraryId, targetPatchAsset.asset_id, {
        normalized_summary: `${targetPatchAsset.title}，已人工确认。`,
        review_status: "reviewed"
    });
    if (!patchResult) {
      fail("patch_asset_card failed");
    }

    const activeAssets = storage.queryAssets({ library_id: libraryId }).asset_cards;
    const archiveTarget = activeAssets.find((asset) => asset.asset_id !== targetPatchAsset.asset_id);
    if (!archiveTarget) {
      fail("No second active asset available to archive.");
    }

    const archiveResult = storage.setAssetState(libraryId, archiveTarget.asset_id, "archived");
    if (!archiveResult) {
      fail("archive_asset failed");
    }

    const postArchiveQuery = storage.queryAssets({ library_id: libraryId });
    const restoreResult = storage.setAssetState(libraryId, archiveTarget.asset_id, "active");
    if (!restoreResult) {
      fail("restore_asset failed");
    }

    const afterOverview = storage.getLibraryOverview(libraryId);
    const afterReviewQueue = storage.listReviewQueue(libraryId);
    const finalQuery = storage.queryAssets({ library_id: libraryId });

    const summary = {
      run_root: runRoot,
      db_path: dbPath,
      library_id: libraryId,
      before_overview: beforeOverview,
      after_overview: afterOverview,
      patched_asset_id: patchResult.asset_card.asset_id,
      patched_from_review_queue: reviewQueue.asset_cards.some(
        (asset) => asset.asset_id === patchResult.asset_card.asset_id
      ),
      archived_asset_id: archiveResult.asset_card.asset_id,
      review_queue_before: reviewQueue.asset_cards.length,
      review_queue_after: afterReviewQueue.asset_cards.length,
      active_query_after_archive: postArchiveQuery.asset_cards.map((asset) => asset.asset_id),
      final_active_assets: finalQuery.asset_cards.map((asset) => asset.asset_id)
    };

    writeFileSync(join(runRoot, "summary.json"), JSON.stringify(summary, null, 2));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    storage.close();
  }
}

main();
