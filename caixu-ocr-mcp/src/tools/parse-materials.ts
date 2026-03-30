import { randomUUID } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import {
  type ParseMaterialsData,
  type ParsedFile,
  type ToolError,
  makeToolResult
} from "@caixu/contracts";
import { ZhipuParserError, parseFileWithZhipu } from "./zhipu-file-parser.js";

const textExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml"
]);

const liveParseExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

const mimeByExt: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function guessMimeType(filePath: string): string {
  return mimeByExt[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function summarizeText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function createToolError(input: {
  code: string;
  message: string;
  retryable: boolean;
  fileId: string;
}): ToolError {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    file_id: input.fileId
  };
}

function normalizeParseMode(): "auto" | "local" {
  return process.env.CAIXU_PARSE_MODE === "local" ? "local" : "auto";
}

function getLiveFileType(filePath: string): string {
  return extname(filePath).replace(/^\./, "").toUpperCase();
}

export async function parseMaterialPaths(input: {
  file_paths: string[];
  goal?: string;
}): Promise<ReturnType<typeof makeToolResult<ParseMaterialsData>>> {
  const parsedFiles: ParsedFile[] = [];
  const failedFiles: ToolError[] = [];
  const parseMode = normalizeParseMode();
  const zhipuApiKey = process.env.ZHIPU_API_KEY?.trim() ?? "";

  for (const rawPath of input.file_paths) {
    const filePath = resolve(rawPath);
    const fileId = `file_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      await access(filePath);
      const fileStat = await stat(filePath);
      const mimeType = guessMimeType(filePath);
      const extension = extname(filePath).toLowerCase();
      const isTextLike = textExtensions.has(extension);
      const isLiveParseCandidate = liveParseExtensions.has(extension);

      let extractedText: string | null = null;
      let extractedSummary: string | null = null;
      let parseStatus: ParsedFile["parse_status"] = "binary_only";
      let provider: ParsedFile["provider"] = "local";

      if (isTextLike) {
        extractedText = await readFile(filePath, "utf8");
        extractedSummary = summarizeText(extractedText);
        parseStatus = "parsed";
      } else if (mimeType.startsWith("text/")) {
        extractedText = await readFile(filePath, "utf8");
        extractedSummary = summarizeText(extractedText);
        parseStatus = "parsed";
      } else if (isLiveParseCandidate && parseMode !== "local") {
        if (!zhipuApiKey) {
          failedFiles.push(
            createToolError({
              code: "ZHIPU_API_KEY_MISSING",
              message: `ZHIPU_API_KEY is required to parse ${basename(filePath)} via live OCR`,
              retryable: false,
              fileId
            })
          );
          continue;
        }

        try {
          extractedText = await parseFileWithZhipu({
            filePath,
            mimeType,
            fileType: getLiveFileType(filePath),
            apiKey: zhipuApiKey
          });
          extractedSummary = extractedText.trim()
            ? summarizeText(extractedText)
            : `Live parser returned empty text: ${basename(filePath)}`;
          parseStatus = "parsed";
          provider = "zhipu";
        } catch (error) {
          if (error instanceof ZhipuParserError) {
            failedFiles.push(
              createToolError({
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                fileId
              })
            );
            continue;
          }

          failedFiles.push(
            createToolError({
              code: "ZHIPU_PARSER_REQUEST_FAILED",
              message: error instanceof Error ? error.message : "Unknown live parse error",
              retryable: true,
              fileId
            })
          );
          continue;
        }
      } else {
        extractedSummary =
          parseMode === "local" && isLiveParseCandidate
            ? `Binary file recorded without live OCR because CAIXU_PARSE_MODE=local: ${basename(filePath)}`
            : `Binary file recorded for downstream OCR or manual extraction: ${basename(filePath)}`;
      }

      parsedFiles.push({
        file_id: fileId,
        file_name: basename(filePath),
        file_path: filePath,
        mime_type: mimeType,
        size_bytes: fileStat.size,
        parse_status: parseStatus,
        extracted_text: extractedText,
        extracted_summary: extractedSummary,
        provider
      });
    } catch (error) {
      failedFiles.push(
        createToolError({
          code: "PARSE_MATERIAL_FAILED",
          message: error instanceof Error ? error.message : "Unknown parse error",
          retryable: false,
          fileId
        })
      );
    }
  }

  const data: ParseMaterialsData = {
    file_ids: parsedFiles.map((file) => file.file_id),
    parsed_count: parsedFiles.length,
    failed_count: failedFiles.length,
    parsed_files: parsedFiles,
    failed_files: failedFiles
  };

  if (parsedFiles.length === 0) {
    return makeToolResult("failed", data, {
      errors: failedFiles,
      next_recommended_skill: []
    });
  }

  return makeToolResult(failedFiles.length > 0 ? "partial" : "success", data, {
    errors: failedFiles,
    next_recommended_skill: ["build-asset-library"]
  });
}
