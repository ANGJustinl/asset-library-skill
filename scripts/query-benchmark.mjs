#!/usr/bin/env node

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDataService } from "../caixu-data-mcp/dist/src/service.js";
import { openCaixuStorage } from "../caixu-shared-core/packages/storage/dist/src/index.js";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeDisabledEmbedder() {
  return {
    modelId: "disabled",
    dimensions: 384,
    embedTexts() {
      throw new Error("embedding disabled for FTS+tag benchmark mode");
    }
  };
}

function simplifyAsset(asset) {
  return {
    asset_id: asset.asset_id,
    title: asset.title,
    material_type: asset.material_type,
    review_status: asset.review_status,
    agent_tags: asset.agent_tags,
    reusable_scenarios: asset.reusable_scenarios,
    normalized_summary: asset.normalized_summary
  };
}

function computeRelevance(asset, expectation) {
  let score = 0;

  if (
    expectation.material_types?.length &&
    expectation.material_types.includes(asset.material_type)
  ) {
    score += 1;
  }

  if (
    expectation.review_statuses?.length &&
    expectation.review_statuses.includes(asset.review_status)
  ) {
    score += 1;
  }

  if (
    expectation.tags_any?.length &&
    expectation.tags_any.some((tag) => asset.agent_tags.includes(tag))
  ) {
    score += 1;
  }

  if (
    expectation.title_patterns?.length &&
    expectation.title_patterns.some((pattern) => pattern.test(asset.title))
  ) {
    score += 1;
  }

  if (
    expectation.summary_patterns?.length &&
    expectation.summary_patterns.some((pattern) =>
      pattern.test(asset.normalized_summary ?? "")
    )
  ) {
    score += 1;
  }

  return {
    score,
    relevant: score >= (expectation.min_score ?? 1)
  };
}

function evaluateMode(result, expectation, topK) {
  const assets = result.data?.asset_cards ?? [];
  const top = assets.slice(0, topK);
  const judged = top.map((asset) => {
    const relevance = computeRelevance(asset, expectation);
    return {
      ...simplifyAsset(asset),
      relevance_score: relevance.score,
      relevant: relevance.relevant
    };
  });
  const relevantHits = judged.filter((asset) => asset.relevant).length;

  return {
    status: result.status,
    warnings: result.warnings ?? [],
    errors: result.errors ?? [],
    returned_count: assets.length,
    top_k: topK,
    precision_at_k: top.length > 0 ? relevantHits / top.length : 0,
    relevant_hits: relevantHits,
    top_results: judged
  };
}

function buildCases() {
  return [
    {
      id: "resume_lookup",
      user_query: "找我的简历",
      legacy: {
        keyword: "简历",
        material_types: ["experience"]
      },
      enhanced: {
        semantic_query: "个人简历与项目经历材料",
        tag_filters_any: ["doc:resume"],
        material_types: ["experience"],
        limit: 5
      },
      expectation: {
        material_types: ["experience"],
        tags_any: ["doc:resume"],
        title_patterns: [/简历|resume/i],
        min_score: 2
      }
    },
    {
      id: "transcript_lookup",
      user_query: "查成绩单和第二课堂成绩单",
      legacy: {
        keyword: "成绩单"
      },
      enhanced: {
        semantic_query: "成绩单 transcript 第二课堂成绩单",
        tag_filters_any: ["doc:transcript", "entity:transcript"],
        limit: 5
      },
      expectation: {
        tags_any: ["doc:transcript", "entity:transcript"],
        title_patterns: [/成绩单|transcript/i],
        min_score: 1
      }
    },
    {
      id: "job_application_proofs",
      user_query: "找可用于求职申请的证明材料",
      legacy: {
        keyword: "证书",
        material_types: ["proof"],
        reusable_scenario: "job_application"
      },
      enhanced: {
        semantic_query: "求职申请可复用的证明材料",
        tag_filters_any: ["use:job_application"],
        material_types: ["proof"],
        limit: 5
      },
      expectation: {
        material_types: ["proof"],
        tags_any: ["use:job_application"],
        title_patterns: [/证书|certificate|证明/i],
        min_score: 2
      }
    },
    {
      id: "needs_review_assets",
      user_query: "找需要人工复核的材料",
      legacy: {
        keyword: "复核"
      },
      enhanced: {
        semantic_query: "需要人工复核的材料",
        tag_filters_any: ["risk:needs_review"],
        limit: 5
      },
      expectation: {
        tags_any: ["risk:needs_review"],
        review_statuses: ["needs_review"],
        min_score: 1
      }
    },
    {
      id: "competition_certificates",
      user_query: "查竞赛获奖证书",
      legacy: {
        keyword: "获奖",
        material_types: ["proof"]
      },
      enhanced: {
        semantic_query: "竞赛获奖证书 荣誉证书 比赛获奖材料",
        tag_filters_any: ["doc:certificate", "entity:award_certificate"],
        material_types: ["proof"],
        limit: 5
      },
      expectation: {
        material_types: ["proof"],
        tags_any: ["doc:certificate", "entity:award_certificate"],
        title_patterns: [/获奖|荣誉|证书|certificate/i],
        min_score: 2
      }
    }
  ];
}

function buildAggregate(caseResults) {
  const modes = ["legacy_like", "fts_tag", "vector_optional"];
  const aggregate = {};

  for (const mode of modes) {
    const precisions = caseResults.map((item) => item.modes[mode].precision_at_k);
    aggregate[mode] = {
      mean_precision_at_k:
        precisions.reduce((sum, value) => sum + value, 0) / precisions.length,
      successful_cases: caseResults.filter((item) => item.modes[mode].status !== "failed").length,
      cases_with_hits: caseResults.filter((item) => item.modes[mode].returned_count > 0).length
    };
  }

  return aggregate;
}

function main() {
  const dbPathArg = process.argv[2];
  const libraryIdArg = process.argv[3];
  const topKArg = Number.parseInt(process.argv[4] ?? "", 10);
  const topK = Number.isFinite(topKArg) && topKArg > 0 ? topKArg : 5;

  if (!dbPathArg || !libraryIdArg) {
    fail(
      "Usage: node scripts/query-benchmark.mjs /ABS/PATH/caixu.sqlite <library_id> [topK]"
    );
  }

  const dbPath = resolve(dbPathArg);
  const libraryId = libraryIdArg;
  const runRoot = makeTempDir("caixu-query-benchmark-");

  const storage = openCaixuStorage(dbPath);
  const ftsTagService = createDataService(dbPath, {
    searchEmbedder: makeDisabledEmbedder(),
    embeddingModelId: "disabled"
  });
  const vectorService = createDataService(dbPath);

  try {
    const reindex = vectorService.reindexLibrarySearch({ library_id: libraryId });
    const overview = vectorService.getLibraryOverview({ library_id: libraryId });
    const allAssets = storage.queryAssets({
      library_id: libraryId,
      asset_states: ["active", "archived"]
    });
    const cases = buildCases();

    const caseResults = cases.map((testCase) => {
      const legacyResult = {
        status: "success",
        data: storage.queryAssets({
          library_id: libraryId,
          asset_states: ["active"],
          ...testCase.legacy,
          limit: topK
        }),
        warnings: [],
        errors: []
      };

      const ftsTagResult = ftsTagService.queryAssets({
        library_id: libraryId,
        asset_states: ["active"],
        ...testCase.enhanced
      });

      const vectorResult = vectorService.queryAssetsVector({
        library_id: libraryId,
        asset_states: ["active"],
        ...testCase.enhanced
      });

      return {
        id: testCase.id,
        user_query: testCase.user_query,
        modes: {
          legacy_like: evaluateMode(legacyResult, testCase.expectation, topK),
          fts_tag: evaluateMode(ftsTagResult, testCase.expectation, topK),
          vector_optional: evaluateMode(vectorResult, testCase.expectation, topK)
        }
      };
    });

    const result = {
      run_root: runRoot,
      db_path: dbPath,
      library_id: libraryId,
      top_k: topK,
      reindex_status: reindex.status,
      reindex_warnings: reindex.warnings ?? [],
      reindex_data: reindex.data ?? null,
      library_overview: overview.data ?? null,
      library_asset_count: allAssets.asset_cards.length,
      cases: caseResults,
      aggregate: buildAggregate(caseResults)
    };

    writeFileSync(join(runRoot, "benchmark.json"), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    vectorService.close();
    ftsTagService.close();
    storage.close();
  }
}

main();
