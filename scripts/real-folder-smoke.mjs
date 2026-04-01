import { mkdtempSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createDataService } from "../caixu-data-mcp/dist/src/service.js";
import { listLocalFilesTool } from "../caixu-ocr-mcp/dist/src/tools/list-local-files.js";
import { readLocalTextFileTool } from "../caixu-ocr-mcp/dist/src/tools/read-local-text-file.js";
import { extractParserTextTool } from "../caixu-ocr-mcp/dist/src/tools/extract-parser-text.js";
import { extractVisualTextTool } from "../caixu-ocr-mcp/dist/src/tools/extract-visual-text.js";
import {
  createSkillModelClientFromEnv,
  runBuildAssetLibrarySkill,
  runIngestRouteDecisionSkill
} from "../caixu-shared-core/packages/skill-runner/dist/src/index.js";
import { appendJsonlRecord, pushRecentEvent } from "./lib/jsonl-progress.mjs";

const inputRoot = process.argv[2];
const buildAssetMaxRetries = Number.isFinite(
  Number.parseInt(process.env.CAIXU_BUILD_ASSET_MAX_RETRIES ?? "2", 10)
)
  ? Number.parseInt(process.env.CAIXU_BUILD_ASSET_MAX_RETRIES ?? "2", 10)
  : 2;
const fileBatchSize = Number.isFinite(
  Number.parseInt(process.env.CAIXU_FILE_BATCH_SIZE ?? "6", 10)
)
  ? Number.parseInt(process.env.CAIXU_FILE_BATCH_SIZE ?? "6", 10)
  : 6;
const buildFailureStreakLimit = Number.isFinite(
  Number.parseInt(process.env.CAIXU_BUILD_FAILURE_STREAK_LIMIT ?? "2", 10)
)
  ? Math.max(1, Number.parseInt(process.env.CAIXU_BUILD_FAILURE_STREAK_LIMIT ?? "2", 10))
  : 2;
const buildRateLimitFailureLimit = Number.isFinite(
  Number.parseInt(process.env.CAIXU_BUILD_RATE_LIMIT_FAILURE_LIMIT ?? "1", 10)
)
  ? Math.max(
      1,
      Number.parseInt(process.env.CAIXU_BUILD_RATE_LIMIT_FAILURE_LIMIT ?? "1", 10)
    )
  : 1;
const cliProgressEnabled = !["0", "false", "no", "off"].includes(
  String(process.env.CAIXU_CLI_PROGRESS ?? "true").trim().toLowerCase()
);
const cliHeartbeatMs = Number.isFinite(
  Number.parseInt(process.env.CAIXU_CLI_HEARTBEAT_MS ?? "5000", 10)
)
  ? Number.parseInt(process.env.CAIXU_CLI_HEARTBEAT_MS ?? "5000", 10)
  : 5000;
const ingestRouteFallbackEnabled = !["0", "false", "no", "off"].includes(
  String(process.env.CAIXU_INGEST_ROUTE_FALLBACK_TO_SUGGESTED ?? "true")
    .trim()
    .toLowerCase()
);

if (!inputRoot) {
  console.error("Usage: node scripts/real-folder-smoke.mjs <input-dir>");
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function chunkFiles(items, chunkSize) {
  if (!chunkSize || chunkSize <= 0) {
    return [items];
  }

  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function nullFieldCounts(assetCards) {
  return {
    holder_name: assetCards.filter((asset) => asset.holder_name === null).length,
    issuer_name: assetCards.filter((asset) => asset.issuer_name === null).length,
    issue_date: assetCards.filter((asset) => asset.issue_date === null).length
  };
}

function writeJson(filePath, payload) {
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function mergeTextSegments(segments) {
  const uniqueLines = [];
  const seen = new Set();
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    for (const line of String(segment).split(/\r?\n/u)) {
      const normalized = line.trim().replace(/\s+/gu, " ");
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      uniqueLines.push(line.trim());
    }
  }
  return uniqueLines.length > 0 ? uniqueLines.join("\n") : null;
}

function summarizeText(text) {
  const compact = String(text).replace(/\s+/gu, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function buildToolError(input) {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    file_id: input.fileId ?? null,
    file_name: input.fileName ?? null,
    asset_id: input.assetId ?? null
  };
}

function mergeProviders(left, right) {
  if (left && right && left !== right) {
    return "hybrid";
  }
  return left ?? right ?? "local";
}

function toWarningErrors(errors) {
  return (errors ?? []).map((error) => ({
    ...error,
    retryable: error.retryable
  }));
}

function normalizeBooleanEnv(value, defaultValue) {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function hasRateLimitError(errors) {
  return errors.some((error) => {
    if (error?.code === "SKILL_RUNNER_RATE_LIMITED") {
      return true;
    }
    const message = String(error?.message ?? "");
    return /\b429\b/u.test(message) || /rate limit/iu.test(message) || message.includes("速率限制");
  });
}

function isRecoverableIngestRouteError(error) {
  return [
    "SKILL_RUNNER_SCHEMA_INVALID",
    "SKILL_RUNNER_REASONING_ONLY_RESPONSE",
    "SKILL_RUNNER_EMPTY_CONTENT_TRUNCATED",
    "SKILL_RUNNER_NO_MESSAGE_CONTENT",
    "SKILL_RUNNER_MODEL_TIMEOUT",
    "SKILL_RUNNER_RATE_LIMITED"
  ].includes(String(error?.code ?? ""));
}

function shouldFallbackIngestRouteDecision(errors) {
  return (
    ingestRouteFallbackEnabled &&
    errors.length > 0 &&
    errors.every((error) => isRecoverableIngestRouteError(error))
  );
}

function buildContinueAssessment({ assetCards, totalFiles, failedCount }) {
  const nonResumeProofAssets = assetCards.filter(
    (asset) =>
      asset.material_type === "proof" && !/简历|resume/iu.test(asset.title)
  );
  const hardFailedRate = totalFiles > 0 ? failedCount / totalFiles : 0;
  const canContinue =
    assetCards.length > 0 &&
    nonResumeProofAssets.length > 0 &&
    hardFailedRate <= 0.3;
  const reasons = [];

  if (assetCards.length > 0) {
    reasons.push(`资产卡 ${assetCards.length} 份`);
  } else {
    reasons.push("资产卡为 0");
  }

  if (nonResumeProofAssets.length > 0) {
    reasons.push(`非简历 proof ${nonResumeProofAssets.length} 份`);
  } else {
    reasons.push("缺少非简历 proof");
  }

  reasons.push(`硬失败率 ${(hardFailedRate * 100).toFixed(1)}%`);

  return {
    canContinue,
    reasons,
    hardFailedRate
  };
}

function createHeartbeat(input) {
  if (cliHeartbeatMs <= 0) {
    return { stop() {} };
  }

  const interval = setInterval(() => {
    if (Date.now() - lastEventAt < cliHeartbeatMs) {
      return;
    }

    emitEvent({
      event: input.event,
      stage: input.stage,
      status: "running",
      batch_number: input.batchNumber,
      total_batches: input.totalBatches,
      file_count: input.fileCount,
      elapsed_ms: Date.now() - input.startedAtMs,
      message: `Heartbeat: ${input.stage}; last_action=${lastEventMessage}`
    });
  }, cliHeartbeatMs);

  return {
    stop() {
      clearInterval(interval);
    }
  };
}

async function processRoutedFile(input) {
  const warnings = [];
  const failedFiles = [];
  const skippedFiles = [];

  const route = input.route;
  const file = input.file;

  if (route === "skip") {
    skippedFiles.push(
      buildToolError({
        code: "INGEST_ROUTE_SKIPPED",
        message: input.reason
          ? `Skipped ${file.file_name}: ${input.reason}`
          : `Skipped ${file.file_name}`,
        retryable: false,
        fileId: file.file_id,
        fileName: file.file_name
      })
    );
    return { parsedFile: null, warnings, failedFiles, skippedFiles };
  }

  if (route === "text") {
    const result = await readLocalTextFileTool({ file });
    if (result.status === "failed" || !result.data) {
      return {
        parsedFile: null,
        warnings,
        failedFiles: result.errors ?? [],
        skippedFiles
      };
    }
    const parsedFile = {
      file_id: file.file_id,
      file_name: file.file_name,
      file_path: file.file_path,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      parse_status: "parsed",
      extracted_text: result.data.text,
      extracted_summary: summarizeText(result.data.text),
      provider: "local"
    };
    return { parsedFile, warnings, failedFiles, skippedFiles };
  }

  if (route === "parser_lite" || route === "parser_export") {
    const parserResult = await extractParserTextTool({
      file,
      mode: route === "parser_export" ? "export" : "lite"
    });
    let extractedText =
      parserResult.status !== "failed" && parserResult.data ? parserResult.data.text : null;
    let provider =
      parserResult.status !== "failed" && parserResult.data ? parserResult.data.provider : null;
    const parserErrors = parserResult.status === "failed" ? parserResult.errors ?? [] : [];
    warnings.push(...(parserResult.data?.warnings ?? []));

    const visualEngine = normalizeBooleanEnv(process.env.CAIXU_ZHIPU_OCR_ENABLED, false)
      ? "ocr"
      : "vlm";
    const parserAlreadyUsedVisualFallback =
      provider === "hybrid" || provider === "zhipu_ocr" || provider === "zhipu_vlm";
    const shouldUsePdfVisualFallback =
      file.mime_type === "application/pdf" && !parserAlreadyUsedVisualFallback;
    const shouldUseExportVisualAssets =
      !shouldUsePdfVisualFallback &&
      route === "parser_export" &&
      parserResult.status !== "failed" &&
      !!parserResult.data &&
      parserResult.data.export_assets.length > 0;

    if (shouldUsePdfVisualFallback) {
      const visualResult = await extractVisualTextTool({
        engine: visualEngine,
        items: [
          {
            file_name: file.file_name,
            file_path: file.file_path,
            mime_type: file.mime_type
          }
        ]
      });
      if (visualResult.data?.outputs?.length) {
        extractedText = mergeTextSegments([
          extractedText,
          ...visualResult.data.outputs.map((item) => item.text)
        ]);
        provider = mergeProviders(provider, visualResult.data.provider);
      }
      warnings.push(...(visualResult.data?.warnings ?? []));
      if (parserErrors.length > 0 && extractedText) {
        warnings.push(...toWarningErrors(parserErrors));
      } else if (visualResult.status === "failed" && !extractedText) {
        return {
          parsedFile: null,
          warnings,
          failedFiles: [...parserErrors, ...(visualResult.errors ?? [])],
          skippedFiles
        };
      }
    } else if (shouldUseExportVisualAssets) {
      const visualResult = await extractVisualTextTool({
        engine: visualEngine,
        items: parserResult.data.export_assets
      });
      if (visualResult.data?.outputs?.length) {
        extractedText = mergeTextSegments([
          extractedText,
          ...visualResult.data.outputs.map((item) => item.text)
        ]);
        provider = mergeProviders(provider, visualResult.data.provider);
      }
      warnings.push(...(visualResult.data?.warnings ?? []));
      if (visualResult.status === "failed" && !extractedText) {
        return {
          parsedFile: null,
          warnings,
          failedFiles: visualResult.errors ?? [],
          skippedFiles
        };
      }
    } else if (parserErrors.length > 0) {
      return {
        parsedFile: null,
        warnings,
        failedFiles: parserErrors,
        skippedFiles
      };
    }

    if (!extractedText) {
      return {
        parsedFile: null,
        warnings,
        failedFiles: [
          buildToolError({
            code: "INGEST_NO_TEXT_EXTRACTED",
            message: `No text extracted from ${file.file_name}.`,
            retryable: false,
            fileId: file.file_id,
            fileName: file.file_name
          })
        ],
        skippedFiles
      };
    }

    const parsedFile = {
      file_id: file.file_id,
      file_name: file.file_name,
      file_path: file.file_path,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      parse_status: "parsed",
      extracted_text: extractedText,
      extracted_summary: summarizeText(extractedText),
      provider
    };
    return { parsedFile, warnings, failedFiles, skippedFiles };
  }

  if (route === "ocr" || route === "vlm") {
    const visualResult = await extractVisualTextTool({
      engine: route === "ocr" ? "ocr" : "vlm",
      items: [
        {
          file_name: file.file_name,
          file_path: file.file_path,
          mime_type: file.mime_type
        }
      ]
    });

    if (visualResult.status === "failed" || !visualResult.data) {
      return {
        parsedFile: null,
        warnings,
        failedFiles: visualResult.errors ?? [],
        skippedFiles
      };
    }

    const extractedText = mergeTextSegments(
      visualResult.data.outputs.map((item) => item.text)
    );
    warnings.push(...(visualResult.data.warnings ?? []));

    if (!extractedText) {
      return {
        parsedFile: null,
        warnings,
        failedFiles: [
          buildToolError({
            code: "INGEST_NO_TEXT_EXTRACTED",
            message: `No text extracted from ${file.file_name}.`,
            retryable: false,
            fileId: file.file_id,
            fileName: file.file_name
          })
        ],
        skippedFiles
      };
    }

    const parsedFile = {
      file_id: file.file_id,
      file_name: file.file_name,
      file_path: file.file_path,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      parse_status: "parsed",
      extracted_text: extractedText,
      extracted_summary: summarizeText(extractedText),
      provider: visualResult.data.provider
    };
    return { parsedFile, warnings, failedFiles, skippedFiles };
  }

  return {
    parsedFile: null,
    warnings,
    failedFiles: [
      buildToolError({
        code: "INGEST_ROUTE_UNSUPPORTED",
        message: `Unsupported ingest route ${route} for ${file.file_name}.`,
        retryable: false,
        fileId: file.file_id,
        fileName: file.file_name
      })
    ],
    skippedFiles
  };
}

let libraryId = null;
let recentEvents = [];
let lastEventAt = Date.now();
let lastEventMessage = "run_initialized";
let progress = null;

const runRoot = mkdtempSync(path.join(tmpdir(), "caixu-real-run-"));
const runId = path.basename(runRoot);
const dbPath = path.join(runRoot, "caixu.sqlite");
const progressPath = path.join(runRoot, "progress.json");
const progressJsonlPath =
  process.env.CAIXU_CLI_PROGRESS_JSONL_PATH?.trim()
    ? path.resolve(process.env.CAIXU_CLI_PROGRESS_JSONL_PATH.trim())
    : path.join(runRoot, "progress.jsonl");
const summaryPath = path.join(runRoot, "summary.json");
const queryPath = path.join(runRoot, "query-proof-assets.json");
const service = createDataService(dbPath);
const repoRoot = path.join(import.meta.dirname, "..");

function updateProgress(patch = {}) {
  Object.assign(progress, patch, {
    updated_at: nowIso()
  });
  progress.last_event = recentEvents.at(-1) ?? null;
  progress.recent_events = recentEvents;
  writeJson(progressPath, progress);
}

function emitEvent(event) {
  const enrichedEvent = {
    ts: nowIso(),
    run_id: runId,
    run_root: runRoot,
    library_id: libraryId,
    source: event.source ?? "real-folder-smoke",
    ...event
  };

  lastEventAt = Date.now();
  lastEventMessage = enrichedEvent.message ?? enrichedEvent.event;
  recentEvents = pushRecentEvent(
    recentEvents,
    {
      ts: enrichedEvent.ts,
      source: enrichedEvent.source,
      event: enrichedEvent.event,
      stage: enrichedEvent.stage,
      status: enrichedEvent.status,
      message: enrichedEvent.message,
      batch_number: enrichedEvent.batch_number ?? null
    },
    50
  );

  if (cliProgressEnabled) {
    appendJsonlRecord(progressJsonlPath, enrichedEvent);
  }

  updateProgress();
}

function buildSummary(input) {
  const continueAssessment = buildContinueAssessment({
    assetCards: input.assetCards,
    totalFiles: input.totalFiles,
    failedCount: input.failedCount
  });

  return {
    run_root: runRoot,
    db_path: dbPath,
    input_root: inputRoot,
    library_id: libraryId,
    ingest_run_id: input.ingestRunId,
    build_run_id: input.buildRunId,
    total_files: input.totalFiles,
    batch_size: fileBatchSize,
    batch_count: input.batchCount,
    batch_reports: input.batchReports,
    parsed_count: input.parsedCount,
    failed_count: input.failedCount,
    warning_count: input.warningCount,
    skipped_count: input.skippedCount,
    parsed_provider_breakdown: countBy(input.allParsedFiles, (file) => file.provider),
    failed_files: input.allFailedFiles,
    warning_files: input.allWarningFiles,
    skipped_files: input.allSkippedFiles,
    build_status: input.aggregateBuildStatus,
    build_errors: input.buildErrors,
    asset_cards_count: input.assetCards.length,
    merged_assets_count: input.mergedAssets.length,
    reusable_scenarios: [...new Set(input.assetCards.flatMap((asset) => asset.reusable_scenarios))].sort(),
    material_type_breakdown: countBy(input.assetCards, (asset) => asset.material_type),
    null_field_counts: nullFieldCounts(input.assetCards),
    skipped_asset_files: input.skippedAssetFiles,
    can_continue_to_query_check_package: continueAssessment.canContinue,
    continue_reasons: continueAssessment.reasons,
    hard_failed_rate: continueAssessment.hardFailedRate,
    asset_preview: input.assetCards.slice(0, 20).map((asset) => ({
      asset_id: asset.asset_id,
      title: asset.title,
      material_type: asset.material_type,
      holder_name: asset.holder_name,
      issuer_name: asset.issuer_name,
      issue_date: asset.issue_date,
      reusable_scenarios: asset.reusable_scenarios,
      confidence: asset.confidence
    })),
    fatal_error: input.fatalError
      ? {
          message:
            input.fatalError instanceof Error
              ? input.fatalError.message
              : String(input.fatalError)
        }
      : null
  };
}

function appendStep(runIdValue, input) {
  if (!runIdValue) {
    return;
  }
  service.appendPipelineStep({
    run_id: runIdValue,
    stage: input.stage,
    status: input.status,
    tool_name: input.tool_name,
    message: input.message,
    payload_json: input.payload_json ?? null
  });
}

progress = {
  run_id: runId,
  started_at: nowIso(),
  updated_at: nowIso(),
  status: "running",
  stage: "init",
  input_root: inputRoot,
  run_root: runRoot,
  progress_jsonl_path: progressJsonlPath,
  db_path: dbPath,
  total_files: 0,
  batch_size: fileBatchSize,
  batch_count: 0,
  parsed_count: 0,
  failed_count: 0,
  warning_count: 0,
  skipped_count: 0,
  asset_cards_count: 0,
  merged_assets_count: 0,
  current_batch: null,
  build_status: "running",
  notes: [],
  last_event: null,
  recent_events: []
};

let finalSummary = null;
let ingestRunId = null;
let buildRunId = null;
let totalFiles = 0;
const batchReports = [];
const allParsedFiles = [];
const allFailedFiles = [];
const allWarningFiles = [];
const allSkippedFiles = [];
const allBuildErrors = [];
const allSkippedAssetFiles = [];
let parsedCount = 0;
let failedCount = 0;
let warningCount = 0;
let skippedCount = 0;
let aggregateBuildStatus = "failed";
let consecutiveBuildFailures = 0;
let consecutiveRateLimitFailures = 0;

try {
  console.error(
    `[caixu] run started: run_root=${runRoot} progress_jsonl=${progressJsonlPath}`
  );
  updateProgress({
    status: "running",
    stage: "starting",
    notes: ["front-foreground run started"]
  });
  emitEvent({
    event: "run.start",
    stage: "starting",
    status: "running",
    message: "Run started."
  });

  const library = service.createOrLoadLibrary({ owner_hint: "real_resume_ingest" });
  libraryId = library.data?.library_id ?? null;
  if (!libraryId) {
    throw new Error("library_id missing");
  }
  emitEvent({
    event: "library.created",
    stage: "starting",
    status: "success",
    message: `Library created: ${libraryId}`
  });

  ingestRunId =
    service.createPipelineRun({
      library_id: libraryId,
      run_type: "ingest",
      input_root: inputRoot,
      latest_stage: "list_local_files"
    }).data?.pipeline_run?.run_id ?? null;

  const fileListing = await listLocalFilesTool({ input_root: inputRoot });
  if (fileListing.status === "failed" || !fileListing.data) {
    throw new Error(fileListing.errors?.[0]?.message ?? "list_local_files failed");
  }
  const allFiles = fileListing.data.files;
  totalFiles = allFiles.length;
  const batches = chunkFiles(allFiles, fileBatchSize);
  appendStep(ingestRunId, {
    stage: "list_local_files",
    status: "completed",
    tool_name: "caixu-ocr-mcp.list_local_files",
    message: `Listed ${allFiles.length} local files.`,
    payload_json: {
      input_root: inputRoot,
      total_files: allFiles.length
    }
  });

  updateProgress({
    total_files: allFiles.length,
    batch_count: batches.length,
    stage: "ingest"
  });

  const modelClient = createSkillModelClientFromEnv({
    onEvent(event) {
      emitEvent(event);
    }
  });

  for (const [batchIndex, batchFiles] of batches.entries()) {
    const batchNumber = batchIndex + 1;
    const batchStart = Date.now();
    updateProgress({
      stage: "ingest",
      current_batch: {
        batch_number: batchNumber,
        total_batches: batches.length,
        phase: "parse",
        files: batchFiles.length,
        started_at: nowIso()
      }
    });
    emitEvent({
      event: "batch.parse.start",
      stage: "ingest",
      status: "running",
      batch_number: batchNumber,
      total_batches: batches.length,
      file_count: batchFiles.length,
      message: `Starting ingest batch ${batchNumber}/${batches.length}.`
    });
    appendStep(ingestRunId, {
      stage: "route_decision",
      status: "running",
      tool_name: null,
      message: `Starting ingest route decision for batch ${batchNumber}/${batches.length}.`,
      payload_json: {
        batch_number: batchNumber,
        total_batches: batches.length,
        file_ids: batchFiles.map((file) => file.file_id)
      }
    });

    const parseHeartbeat = createHeartbeat({
      event: "batch.parse.heartbeat",
      stage: "ingest",
      batchNumber,
      totalBatches: batches.length,
      fileCount: batchFiles.length,
      startedAtMs: batchStart
    });

    const routeDecision = await runIngestRouteDecisionSkill({
      skillDir: path.join(repoRoot, "caixu-ingest-materials"),
      files: batchFiles,
      modelClient,
      maxRetries: 1,
      onEvent(event) {
        emitEvent({
          ...event,
          batch_number: batchNumber,
          total_batches: batches.length,
          file_count: batchFiles.length
        });
      }
    });

    const decisionsByFileId = new Map(
      (routeDecision.data?.decisions ?? []).map((decision) => [decision.file_id, decision])
    );

    if (routeDecision.status === "failed") {
      const routeErrors = routeDecision.errors.length
        ? routeDecision.errors
        : batchFiles.map((file) =>
            buildToolError({
              code: "INGEST_ROUTE_DECISION_FAILED",
              message: `Route decision failed for ${file.file_name}.`,
              retryable: true,
              fileId: file.file_id,
              fileName: file.file_name
            })
          );
      if (shouldFallbackIngestRouteDecision(routeErrors)) {
        appendStep(ingestRunId, {
          stage: "route_decision",
          status: "partial",
          tool_name: null,
          message: `Route decision failed for batch ${batchNumber}/${batches.length}; falling back to suggested_route.`,
          payload_json: {
            errors: routeErrors,
            fallback: "suggested_route"
          }
        });
        for (const file of batchFiles) {
          decisionsByFileId.set(file.file_id, {
            file_id: file.file_id,
            route: file.suggested_route,
            reason:
              file.skip_reason ??
              "fallback_to_suggested_route_after_route_decision_failure"
          });
        }
      } else {
        parseHeartbeat.stop();
        allFailedFiles.push(...routeErrors);
        failedCount += routeErrors.length;
        appendStep(ingestRunId, {
          stage: "route_decision",
          status: "failed",
          tool_name: null,
          message: `Route decision failed for batch ${batchNumber}/${batches.length}.`,
          payload_json: {
            errors: routeErrors
          }
        });
        emitEvent({
          event: "batch.parse.complete",
          stage: "ingest",
          status: "failed",
          batch_number: batchNumber,
          total_batches: batches.length,
          file_count: batchFiles.length,
          elapsed_ms: Date.now() - batchStart,
          counts: {
            parsed: 0,
            failed: routeErrors.length,
            warnings: 0,
            skipped: 0
          },
          message: `Ingest batch ${batchNumber}/${batches.length} failed during route decision.`
        });
        batchReports.push({
          batch_number: batchNumber,
          total_batches: batches.length,
          file_count: batchFiles.length,
          duration_ms: Date.now() - batchStart,
          parsed_count: 0,
          failed_count: routeErrors.length,
          warning_count: 0,
          skipped_count: 0,
          build_status: "skipped",
          extracted_asset_count: 0,
          merged_asset_count: 0,
          skipped_asset_count: 0
        });
        continue;
      }
    }

    const batchParsedFiles = [];
    const batchFailedFiles = [];
    const batchWarningFiles = [];
    const batchSkippedFiles = [];

    for (const file of batchFiles) {
      const decision = decisionsByFileId.get(file.file_id);
      const route = decision?.route ?? file.suggested_route;
      const routeReason = decision?.reason ?? file.skip_reason ?? null;
      const usedFallbackRoute =
        routeDecision.status === "failed" &&
        decision?.reason ===
          "fallback_to_suggested_route_after_route_decision_failure";

      if (usedFallbackRoute) {
        batchWarningFiles.push(
          buildToolError({
            code: "INGEST_ROUTE_FALLBACK_SUGGESTED_ROUTE",
            message: `Route decision fell back to suggested_route for ${file.file_name}.`,
            retryable: true,
            fileId: file.file_id,
            fileName: file.file_name
          })
        );
      }
      appendStep(ingestRunId, {
        stage: "route_decision",
        status:
          route === "skip" ? "skipped" : usedFallbackRoute ? "partial" : "completed",
        tool_name: null,
        message: `Route ${route} selected for ${file.file_name}.`,
        payload_json: {
          file_id: file.file_id,
          route,
          reason: routeReason,
          fallback: usedFallbackRoute
        }
      });

      const toolName =
        route === "text"
          ? "caixu-ocr-mcp.read_local_text_file"
          : route === "parser_lite" || route === "parser_export"
            ? "caixu-ocr-mcp.extract_parser_text"
            : route === "ocr" || route === "vlm"
              ? "caixu-ocr-mcp.extract_visual_text"
              : null;

      emitEvent({
        event: "file.parse.start",
        stage: "ingest",
        status: "running",
        batch_number: batchNumber,
        total_batches: batches.length,
        file_count: 1,
        message: `Processing ${file.file_name} via ${route}.`
      });

      const result = await processRoutedFile({
        file,
        route,
        reason: routeReason
      });
      if (result.parsedFile) {
        batchParsedFiles.push(result.parsedFile);
      }
      batchFailedFiles.push(...result.failedFiles);
      batchWarningFiles.push(...result.warnings);
      batchSkippedFiles.push(...result.skippedFiles);
      appendStep(ingestRunId, {
        stage: "low_level_extract",
        status:
          result.failedFiles.length > 0
            ? "failed"
            : result.skippedFiles.length > 0
              ? "skipped"
              : result.warnings.length > 0
                ? "partial"
                : "completed",
        tool_name: toolName,
        message: `Processed ${file.file_name} via route ${route}.`,
        payload_json: {
          file_id: file.file_id,
          parsed: Boolean(result.parsedFile),
          failed_count: result.failedFiles.length,
          warning_count: result.warnings.length,
          skipped_count: result.skippedFiles.length
        }
      });
      emitEvent({
        event: "file.parse.complete",
        stage: "ingest",
        status:
          result.failedFiles.length > 0
            ? "failed"
            : result.skippedFiles.length > 0
              ? "skipped"
              : result.warnings.length > 0
                ? "partial"
                : "success",
        batch_number: batchNumber,
        total_batches: batches.length,
        file_count: 1,
        counts: {
          parsed: result.parsedFile ? 1 : 0,
          failed: result.failedFiles.length,
          warnings: result.warnings.length,
          skipped: result.skippedFiles.length
        },
        message: `Completed ${file.file_name} via ${route}.`
      });
    }

    parseHeartbeat.stop();

    parsedCount += batchParsedFiles.length;
    failedCount += batchFailedFiles.length;
    warningCount += batchWarningFiles.length;
    skippedCount += batchSkippedFiles.length;
    allParsedFiles.push(...batchParsedFiles);
    allFailedFiles.push(...batchFailedFiles);
    allWarningFiles.push(...batchWarningFiles);
    allSkippedFiles.push(...batchSkippedFiles);

    if (batchParsedFiles.length > 0) {
      service.upsertParsedFiles({ library_id: libraryId, parsed_files: batchParsedFiles });
      appendStep(ingestRunId, {
        stage: "persist_parsed_files",
        status: "completed",
        tool_name: "caixu-data-mcp.upsert_parsed_files",
        message: `Persisted ${batchParsedFiles.length} parsed files for batch ${batchNumber}/${batches.length}.`,
        payload_json: {
          file_ids: batchParsedFiles.map((item) => item.file_id)
        }
      });
    }

    updateProgress({
      parsed_count: parsedCount,
      failed_count: failedCount,
      warning_count: warningCount,
      skipped_count: skippedCount
    });

    emitEvent({
      event: "batch.parse.complete",
      stage: "ingest",
      status:
        batchFailedFiles.length > 0 || batchWarningFiles.length > 0 || batchSkippedFiles.length > 0
          ? "partial"
          : "success",
      batch_number: batchNumber,
      total_batches: batches.length,
      file_count: batchFiles.length,
      elapsed_ms: Date.now() - batchStart,
      counts: {
        parsed: batchParsedFiles.length,
        failed: batchFailedFiles.length,
        warnings: batchWarningFiles.length,
        skipped: batchSkippedFiles.length
      },
      message: `Completed ingest batch ${batchNumber}/${batches.length}.`
    });

    updateProgress({
      stage: "building_asset_library",
      current_batch: {
        batch_number: batchNumber,
        total_batches: batches.length,
        phase: "build_asset_library",
        files: batchParsedFiles.length
      }
    });

    if (batchParsedFiles.length === 0) {
      batchReports.push({
        batch_number: batchNumber,
        total_batches: batches.length,
        file_count: batchFiles.length,
        duration_ms: Date.now() - batchStart,
        parsed_count: batchParsedFiles.length,
        failed_count: batchFailedFiles.length,
        warning_count: batchWarningFiles.length,
        skipped_count: batchSkippedFiles.length,
        build_status: "skipped",
        extracted_asset_count: 0,
        merged_asset_count: 0,
        skipped_asset_count: 0
      });
      emitEvent({
        event: "batch.build.complete",
        stage: "building_asset_library",
        status: "skipped",
        batch_number: batchNumber,
        total_batches: batches.length,
        file_count: batchFiles.length,
        counts: { assets: 0, merged: 0, skipped_assets: 0, errors: 0 },
        message: `Skipped asset build for batch ${batchNumber}/${batches.length} because no parsed files were produced.`
      });
      continue;
    }

    if (!buildRunId) {
      buildRunId =
        service.createPipelineRun({
          library_id: libraryId,
          run_type: "build_asset_library",
          input_root: inputRoot,
          latest_stage: "load_parsed_files"
        }).data?.pipeline_run?.run_id ?? null;
    }

    const existingAssets = service.queryAssets({ library_id: libraryId }).data?.asset_cards ?? [];
    const existingAssetIds = existingAssets.map((asset) => asset.asset_id);
    const parsedFileContext = service.getParsedFiles({ library_id: libraryId }).data?.parsed_files ?? [];

    appendStep(buildRunId, {
      stage: "build_asset_library",
      status: "running",
      tool_name: null,
      message: `Starting build-asset-library for batch ${batchNumber}/${batches.length}.`,
      payload_json: {
        batch_number: batchNumber,
        total_batches: batches.length,
        file_ids: batchParsedFiles.map((file) => file.file_id)
      }
    });

    emitEvent({
      event: "batch.build.start",
      stage: "building_asset_library",
      status: "running",
      batch_number: batchNumber,
      total_batches: batches.length,
      file_count: batchParsedFiles.length,
      message: `Starting asset build for batch ${batchNumber}/${batches.length}.`
    });

    const buildStart = Date.now();
    const buildHeartbeat = createHeartbeat({
      event: "batch.build.heartbeat",
      stage: "building_asset_library",
      batchNumber,
      totalBatches: batches.length,
      fileCount: batchParsedFiles.length,
      startedAtMs: buildStart
    });

    let buildResult;
    try {
      buildResult = await runBuildAssetLibrarySkill({
        skillDir: path.join(repoRoot, "caixu-build-asset-library"),
        library_id: libraryId,
        parsed_files: batchParsedFiles,
        parsed_file_context: parsedFileContext,
        modelClient,
        maxRetries: buildAssetMaxRetries,
        existing_asset_ids: existingAssetIds,
        existing_assets: existingAssets,
        onEvent(event) {
          emitEvent({
            ...event,
            batch_number: batchNumber,
            total_batches: batches.length,
            file_count: batchParsedFiles.length
          });
        },
        onProgress(event) {
          updateProgress({
            current_batch: {
              batch_number: batchNumber,
              total_batches: batches.length,
              phase: `build_asset_library_${event.phase}`,
              status: event.status
            }
          });
        }
      });
    } finally {
      buildHeartbeat.stop();
    }

    const assetCards = buildResult.data?.asset_cards ?? [];
    const mergedAssets = buildResult.data?.merged_assets ?? [];
    allBuildErrors.push(...buildResult.errors);
    allSkippedAssetFiles.push(...buildResult.skipped_files);
    const buildHitRateLimit = hasRateLimitError(buildResult.errors);

    if (assetCards.length > 0) {
      service.upsertAssetCards({ library_id: libraryId, asset_cards: assetCards });
    }
    service.upsertMergedAssets({ library_id: libraryId, merged_assets: mergedAssets });
    service.writeAgentDecisionAudit({
      audit: buildResult.audit,
      run_ref_type: "asset_library_build",
      run_ref_id: `asset_build_${libraryId}_batch_${batchNumber}`
    });
    appendStep(buildRunId, {
      stage: "persist_asset_library",
      status:
        buildResult.status === "success"
          ? "completed"
          : buildResult.status === "partial"
            ? "partial"
            : "failed",
      tool_name: "caixu-data-mcp.upsert_asset_cards",
      message: `Persisted asset build result for batch ${batchNumber}/${batches.length}.`,
      payload_json: {
        asset_count: assetCards.length,
        merged_count: mergedAssets.length,
        skipped_asset_count: buildResult.skipped_files.length,
        error_count: buildResult.errors.length
      }
    });

    if (buildResult.status === "success") {
      aggregateBuildStatus = allBuildErrors.length > 0 ? "partial" : "success";
    } else if (buildResult.status === "partial" && aggregateBuildStatus === "failed") {
      aggregateBuildStatus = "partial";
    }

    if (buildResult.status === "failed") {
      consecutiveBuildFailures += 1;
      consecutiveRateLimitFailures = buildHitRateLimit
        ? consecutiveRateLimitFailures + 1
        : 0;
    } else {
      consecutiveBuildFailures = 0;
      consecutiveRateLimitFailures = 0;
    }

    updateProgress({
      asset_cards_count:
        (progress.asset_cards_count ?? 0) + assetCards.length,
      merged_assets_count:
        (progress.merged_assets_count ?? 0) + mergedAssets.length,
      build_status: buildResult.status
    });

    batchReports.push({
      batch_number: batchNumber,
      total_batches: batches.length,
      file_count: batchFiles.length,
      duration_ms: Date.now() - batchStart,
      parsed_count: batchParsedFiles.length,
      failed_count: batchFailedFiles.length,
      warning_count: batchWarningFiles.length,
      skipped_count: batchSkippedFiles.length,
      build_status: buildResult.status,
      extracted_asset_count: assetCards.length,
      merged_asset_count: mergedAssets.length,
      skipped_asset_count: buildResult.skipped_files.length
    });

    emitEvent({
      event: "batch.build.complete",
      stage: "building_asset_library",
      status: buildResult.status,
      batch_number: batchNumber,
      total_batches: batches.length,
      file_count: batchParsedFiles.length,
      elapsed_ms: Date.now() - buildStart,
      counts: {
        assets: assetCards.length,
        merged: mergedAssets.length,
        skipped_assets: buildResult.skipped_files.length,
        errors: buildResult.errors.length
      },
      message: `Completed asset build for batch ${batchNumber}/${batches.length}.`
    });

    if (buildHitRateLimit && consecutiveRateLimitFailures >= buildRateLimitFailureLimit) {
      throw new Error(
        `BUILD_ASSET_RATE_LIMIT_CIRCUIT_OPEN: consecutive rate-limit build failures reached ${consecutiveRateLimitFailures}/${buildRateLimitFailureLimit}.`
      );
    }

    if (consecutiveBuildFailures >= buildFailureStreakLimit) {
      throw new Error(
        `BUILD_ASSET_FAILURE_CIRCUIT_OPEN: consecutive build failures reached ${consecutiveBuildFailures}/${buildFailureStreakLimit}.`
      );
    }
  }

  service.completePipelineRun({
    run_id: ingestRunId,
    status:
      failedCount > 0 || warningCount > 0 || skippedCount > 0 ? "partial" : "completed",
    latest_stage: "persist_parsed_files",
    counts: {
      parsed: parsedCount,
      failed: failedCount,
      warnings: warningCount,
      skipped: skippedCount,
      assets: 0,
      merged: 0
    }
  });

  const finalQuery = service.queryAssets({
    library_id: libraryId
  });
  const assetCards = finalQuery.data?.asset_cards ?? [];
  const mergedAssets = finalQuery.data?.merged_assets ?? [];

  if (buildRunId) {
    service.completePipelineRun({
      run_id: buildRunId,
      status:
        aggregateBuildStatus === "success"
          ? "completed"
          : aggregateBuildStatus === "partial"
            ? "partial"
            : "failed",
      latest_stage: "persist_asset_library",
      counts: {
        parsed: parsedCount,
        failed: failedCount,
        warnings: warningCount,
        skipped: skippedCount,
        assets: assetCards.length,
        merged: mergedAssets.length
      }
    });
  }

  const queryResult = service.queryAssets({
    library_id: libraryId,
    material_types: ["proof"],
    reusable_scenario: "summer_internship_application"
  });

  const querySummary = {
    status: queryResult.status,
    library_id: libraryId,
    proof_assets_for_internship: queryResult.data?.asset_cards.length ?? 0,
    query_merged_assets_count: queryResult.data?.merged_assets.length ?? 0,
    library_merged_assets_count: mergedAssets.length,
    sample_titles: (queryResult.data?.asset_cards ?? [])
      .slice(0, 10)
      .map((asset) => asset.title)
  };

  finalSummary = buildSummary({
    ingestRunId,
    buildRunId,
    totalFiles,
    batchCount: batches.length,
    parsedCount,
    failedCount,
    warningCount,
    skippedCount,
    allParsedFiles,
    allFailedFiles,
    allWarningFiles,
    allSkippedFiles,
    buildErrors: allBuildErrors,
    aggregateBuildStatus,
    assetCards,
    mergedAssets,
    skippedAssetFiles: allSkippedAssetFiles,
    batchReports,
    fatalError: null
  });

  writeJson(summaryPath, finalSummary);
  writeJson(queryPath, querySummary);
  emitEvent({
    event: "run.complete",
    stage: "done",
    status: aggregateBuildStatus,
    counts: {
      parsed: parsedCount,
      failed: failedCount,
      warnings: warningCount,
      skipped: skippedCount,
      assets: assetCards.length,
      merged: mergedAssets.length
    },
    message: `Run completed with status ${aggregateBuildStatus}.`
  });
  updateProgress({
    status: "completed",
    stage: "done",
    build_status: aggregateBuildStatus,
    asset_cards_count: assetCards.length,
    merged_assets_count: mergedAssets.length,
    current_batch: null
  });

  console.log(JSON.stringify(finalSummary, null, 2));
} catch (error) {
  const assetSnapshot = libraryId
    ? service.queryAssets({ library_id: libraryId }).data
    : undefined;
  finalSummary = buildSummary({
    ingestRunId,
    buildRunId,
    totalFiles,
    batchCount: progress.batch_count ?? 0,
    parsedCount,
    failedCount,
    warningCount,
    skippedCount,
    allParsedFiles,
    allFailedFiles,
    allWarningFiles,
    allSkippedFiles,
    buildErrors: allBuildErrors,
    aggregateBuildStatus,
    assetCards: assetSnapshot?.asset_cards ?? [],
    mergedAssets: assetSnapshot?.merged_assets ?? [],
    skippedAssetFiles: allSkippedAssetFiles,
    batchReports,
    fatalError: error
  });
  writeJson(summaryPath, finalSummary);
  emitEvent({
    event: "run.failed",
    stage: "failed",
    status: "failed",
    counts: {
      parsed: parsedCount,
      failed: failedCount,
      warnings: warningCount,
      skipped: skippedCount
    },
    message: error instanceof Error ? error.message : String(error)
  });
  updateProgress({
    status: "failed",
    stage: "failed",
    build_status: "failed",
    current_batch: null,
    notes: [
      ...(progress.notes ?? []),
      error instanceof Error ? error.message : String(error)
    ]
  });

  if (ingestRunId) {
    service.completePipelineRun({
      run_id: ingestRunId,
      status: "failed",
      latest_stage: "failed",
      counts: {
        parsed: parsedCount,
        failed: failedCount,
        warnings: warningCount,
        skipped: skippedCount,
        assets: 0,
        merged: 0
      }
    });
  }
  if (buildRunId) {
    service.completePipelineRun({
      run_id: buildRunId,
      status: "failed",
      latest_stage: "failed",
      counts: {
        parsed: parsedCount,
        failed: failedCount,
        warnings: warningCount,
        skipped: skippedCount,
        assets: assetSnapshot?.asset_cards?.length ?? 0,
        merged: assetSnapshot?.merged_assets?.length ?? 0
      }
    });
  }

  console.error(
    `[caixu] run failed: run_root=${runRoot} progress_jsonl=${progressJsonlPath}`
  );
  throw error;
} finally {
  service.close();
}
