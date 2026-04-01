import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const parserMock = vi.hoisted(() => ({
  parseWithZhipuParser: vi.fn()
}));

const visualMock = vi.hoisted(() => ({
  extractVisualTextTool: vi.fn()
}));

vi.mock("../src/tools/zhipu-file-parser.js", () => parserMock);
vi.mock("../src/tools/extract-visual-text.js", () => visualMock);

import { extractParserTextTool } from "../src/tools/extract-parser-text.js";

const envKeys = [
  "CAIXU_ZHIPU_PARSER_API_KEY",
  "CAIXU_ZHIPU_OCR_API_KEY",
  "CAIXU_ZHIPU_VLM_API_KEY",
  "CAIXU_ZHIPU_OCR_ENABLED",
  "ZHIPU_API_KEY"
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
) as Record<(typeof envKeys)[number], string | undefined>;

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  parserMock.parseWithZhipuParser.mockReset();
  visualMock.extractVisualTextTool.mockReset();

  for (const key of envKeys) {
    const original = originalEnv[key];
    if (typeof original === "string") {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  }

  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  );
});

async function createTempBinaryFile(fileName: string, content: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "caixu-extract-parser-"));
  tempDirs.push(directory);
  const filePath = join(directory, fileName);
  await writeFile(filePath, content);
  return filePath;
}

describe("@caixu/ocr-mcp extract_parser_text", () => {
  it("falls back to visual OCR for PDF files when parser text is empty", async () => {
    process.env.CAIXU_ZHIPU_PARSER_API_KEY = "parser-key";
    process.env.CAIXU_ZHIPU_OCR_API_KEY = "ocr-key";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "true";

    const filePath = await createTempBinaryFile("scan.pdf", Buffer.from("fake-pdf"));
    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_pdf_empty",
      mode: "lite",
      provider: "zhipu_parser_lite",
      text: null,
      assets: [],
      branchErrors: []
    });
    visualMock.extractVisualTextTool.mockResolvedValue({
      status: "success",
      trace_id: "trace_1",
      run_id: "run_1",
      data: {
        engine: "ocr",
        provider: "zhipu_ocr",
        outputs: [
          {
            file_name: "scan.pdf",
            file_path: filePath,
            mime_type: "application/pdf",
            text: "Scanned PDF text"
          }
        ],
        warnings: []
      },
      warnings: [],
      errors: [],
      next_recommended_skill: []
    });

    const result = await extractParserTextTool({
      file: {
        file_id: "file_pdf_001",
        file_name: "scan.pdf",
        file_path: filePath,
        mime_type: "application/pdf",
        extension: ".pdf",
        size_bytes: 10,
        suggested_route: "parser_lite",
        skip_reason: null
      },
      mode: "lite"
    });

    expect(result.status).toBe("success");
    expect(result.data?.text).toBe("Scanned PDF text");
    expect(result.data?.provider).toBe("zhipu_ocr");
    expect(visualMock.extractVisualTextTool).toHaveBeenCalledTimes(1);
  });
});
