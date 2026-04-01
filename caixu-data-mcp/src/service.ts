import { join } from "node:path";
import {
  type ExtractParserTextData,
  type ExtractVisualTextData,
  type ListLocalFilesData,
  type LocalFile,
  type AgentDecisionAudit,
  type AssetCard,
  type AssetState,
  type ExecutionLog,
  type LifecycleRunData,
  type ListLibrariesData,
  type LibraryOverview,
  type MergedAsset,
  type PackageRunData,
  type PatchAssetCardData,
  type PipelineRunData,
  type PipelineStep,
  type ParsedFile,
  type ReadLocalTextFileData,
  type RenderPdfPagesData,
  type ReviewQueueData,
  type ReviewStatus,
  makeToolResult
} from "@caixu/contracts";
import { getSubmissionProfile } from "@caixu/executor-profiles";
import { getRuleProfileBundle } from "@caixu/rules";
import { openCaixuStorage } from "@caixu/storage";

export function defaultDbPath(): string {
  return process.env.CAIXU_SQLITE_PATH ?? join(process.cwd(), "data", "caixu.sqlite");
}

export function createDataService(dbPath = defaultDbPath()) {
  const storage = openCaixuStorage(dbPath);

  return {
    close: () => storage.close(),
    writeAgentDecisionAudit(input: {
      audit: AgentDecisionAudit;
      run_ref_type: "asset_library_build" | "lifecycle_run" | "package_run";
      run_ref_id: string;
    }) {
      const audit = storage.writeAgentDecisionAudit(input.audit, {
        type: input.run_ref_type,
        id: input.run_ref_id
      });
      return makeToolResult("success", { audit });
    },
    createOrLoadLibrary(input: { library_id?: string; owner_hint?: string }) {
      const library = storage.createOrLoadLibrary(input.library_id, input.owner_hint);
      return makeToolResult("success", { library_id: library.library_id });
    },
    listLibraries() {
      return makeToolResult<ListLibrariesData>("success", storage.listLibraries());
    },
    getLibraryOverview(input: { library_id: string }) {
      const overview = storage.getLibraryOverview(input.library_id);
      return makeToolResult<LibraryOverview | undefined>(
        overview ? "success" : "failed",
        overview ?? undefined
      );
    },
    createPipelineRun(input: {
      run_id?: string;
      library_id: string;
      run_type: "ingest" | "build_asset_library";
      goal?: string;
      input_root?: string;
      latest_stage?: string;
    }) {
      const pipelineRun = storage.createPipelineRun({
        runId: input.run_id,
        libraryId: input.library_id,
        runType: input.run_type,
        goal: input.goal,
        inputRoot: input.input_root,
        latestStage: input.latest_stage
      });
      return makeToolResult("success", {
        pipeline_run: pipelineRun,
        steps: []
      } satisfies PipelineRunData);
    },
    appendPipelineStep(input: {
      run_id: string;
      stage: string;
      status: PipelineStep["status"];
      tool_name?: string;
      message: string;
      payload_json?: unknown;
    }) {
      const step = storage.appendPipelineStep({
        runId: input.run_id,
        stage: input.stage,
        status: input.status,
        toolName: input.tool_name,
        message: input.message,
        payload: input.payload_json ?? null
      });
      return makeToolResult("success", { step });
    },
    getPipelineRun(input: { run_id: string; step_limit?: number }) {
      const run = storage.getPipelineRun(input.run_id, input.step_limit ?? 50);
      return makeToolResult(run?.pipeline_run ? "success" : "failed", run ?? undefined);
    },
    completePipelineRun(input: {
      run_id: string;
      status: "completed" | "partial" | "failed";
      latest_stage: string;
      counts: {
        parsed: number;
        failed: number;
        warnings: number;
        skipped: number;
        assets: number;
        merged: number;
      };
    }) {
      const run = storage.completePipelineRun({
        runId: input.run_id,
        status: input.status,
        latestStage: input.latest_stage,
        counts: input.counts
      });
      return makeToolResult(run?.pipeline_run ? "success" : "failed", run ?? undefined);
    },
    upsertParsedFiles(input: { library_id: string; parsed_files: ParsedFile[] }) {
      const files = storage.upsertParsedFiles(input.library_id, input.parsed_files);
      return makeToolResult("success", {
        library_id: input.library_id,
        file_ids: files.map((file) => file.file_id),
        parsed_files: files
      });
    },
    getParsedFiles(input: { library_id: string; file_ids?: string[] }) {
      const parsedFiles = storage.listParsedFiles(input.library_id, input.file_ids);
      return makeToolResult("success", {
        library_id: input.library_id,
        parsed_files: parsedFiles
      });
    },
    upsertAssetCards(input: { library_id: string; asset_cards: AssetCard[] }) {
      const assetCards = storage.upsertAssetCards(input.library_id, input.asset_cards);
      return makeToolResult("success", {
        library_id: input.library_id,
        asset_cards: assetCards
      });
    },
    queryAssets(input: {
      library_id: string;
      material_types?: string[];
      keyword?: string;
      reusable_scenario?: string;
      validity_statuses?: string[];
      asset_states?: AssetState[];
      review_statuses?: ReviewStatus[];
    }) {
      try {
        return makeToolResult("success", storage.queryAssets(input));
      } catch (error) {
        return makeToolResult("failed", undefined, {
          errors: [
            {
              code: "QUERY_ASSETS_FAILED",
              message: error instanceof Error ? error.message : "Unknown query failure",
              retryable: false
            }
          ]
        });
      }
    },
    upsertMergedAssets(input: { library_id: string; merged_assets: MergedAsset[] }) {
      const mergedAssets = storage.upsertMergedAssets(
        input.library_id,
        input.merged_assets
      );
      return makeToolResult("success", {
        library_id: input.library_id,
        merged_assets: mergedAssets
      });
    },
    patchAssetCard(input: {
      library_id: string;
      asset_id: string;
      patch: Partial<
        Pick<
          AssetCard,
          | "title"
          | "holder_name"
          | "issuer_name"
          | "issue_date"
          | "expiry_date"
          | "validity_status"
          | "reusable_scenarios"
          | "sensitivity_level"
          | "normalized_summary"
          | "review_status"
          | "last_verified_at"
        >
      >;
    }) {
      const result = storage.patchAssetCard(input.library_id, input.asset_id, input.patch);
      return makeToolResult<PatchAssetCardData | undefined>(
        result ? "success" : "failed",
        result
          ? {
              library_id: input.library_id,
              asset_card: result.asset_card,
              change_event: result.change_event
            }
          : undefined
      );
    },
    archiveAsset(input: { library_id: string; asset_id: string }) {
      const result = storage.setAssetState(input.library_id, input.asset_id, "archived");
      return makeToolResult<PatchAssetCardData | undefined>(
        result ? "success" : "failed",
        result
          ? {
              library_id: input.library_id,
              asset_card: result.asset_card,
              change_event: result.change_event
            }
          : undefined
      );
    },
    restoreAsset(input: { library_id: string; asset_id: string }) {
      const result = storage.setAssetState(input.library_id, input.asset_id, "active");
      return makeToolResult<PatchAssetCardData | undefined>(
        result ? "success" : "failed",
        result
          ? {
              library_id: input.library_id,
              asset_card: result.asset_card,
              change_event: result.change_event
            }
          : undefined
      );
    },
    listReviewQueue(input: { library_id: string }) {
      return makeToolResult<ReviewQueueData>("success", storage.listReviewQueue(input.library_id));
    },
    writeLifecycleRun(input: {
      run_id: string;
      goal: string;
      payload: LifecycleRunData["lifecycle_run"];
      audit?: AgentDecisionAudit;
    }) {
      const runData = storage.writeLifecycleRun(
        input.run_id,
        input.payload!,
        input.goal,
        input.audit
      );
      return makeToolResult("success", runData);
    },
    getLatestLifecycleRun(input: { library_id: string; goal?: string }) {
      const lifecycleRun = storage.getLatestLifecycleRun(input.library_id, input.goal);
      return makeToolResult(lifecycleRun ? "success" : "failed", lifecycleRun ?? undefined);
    },
    writePackageRun(input: {
      package_plan: PackageRunData["package_plan"];
      output_dir?: string;
      audit?: AgentDecisionAudit;
    }) {
      const packageRun = storage.writePackageRun(
        input.package_plan!,
        input.output_dir,
        input.audit
      );
      return makeToolResult("success", {
        package_plan: packageRun.package_plan,
        output_dir: packageRun.output_dir,
        audit: packageRun.audit
      });
    },
    getPackageRun(input: { package_id?: string; package_plan_id?: string }) {
      const effectivePackageId = input.package_id ?? input.package_plan_id;
      const packageRun = effectivePackageId
        ? storage.getPackageRun(effectivePackageId)
        : null;
      return makeToolResult(packageRun?.package_plan ? "success" : "failed", packageRun ?? undefined);
    },
    writeExecutionLog(input: { library_id: string; execution_log: ExecutionLog }) {
      const executionLog = storage.writeExecutionLog(input.execution_log);
      return makeToolResult("success", {
        library_id: input.library_id,
        execution_log: executionLog
      });
    },
    getRuleProfile(input: { profile_id: string }) {
      try {
        return makeToolResult("success", {
          profile: getRuleProfileBundle(input.profile_id)
        });
      } catch (error) {
        return makeToolResult("failed", undefined, {
          errors: [
            {
              code: "RULE_PROFILE_NOT_SUPPORTED",
              message: error instanceof Error ? error.message : "Unknown rule profile error",
              retryable: false
            }
          ]
        });
      }
    },
    getSubmissionProfile(input: { profile_id: string }) {
      try {
        return makeToolResult("success", {
          profile: getSubmissionProfile(input.profile_id)
        });
      } catch (error) {
        return makeToolResult("failed", undefined, {
          errors: [
            {
              code: "SUBMISSION_PROFILE_NOT_SUPPORTED",
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown submission profile error",
              retryable: false
            }
          ]
        });
      }
    }
  };
}
