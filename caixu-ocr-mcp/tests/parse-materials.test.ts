import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const parserMock = vi.hoisted(() => ({
  parseWithZhipuParser: vi.fn()
}));

const ocrMock = vi.hoisted(() => ({
  runZhipuLayoutOcr: vi.fn()
}));

const vlmMock = vi.hoisted(() => ({
  runZhipuVlmOcr: vi.fn()
}));

const pdfRenderMock = vi.hoisted(() => ({
  renderPdfToPngBuffers: vi.fn()
}));

vi.mock("../src/tools/zhipu-file-parser.js", () => parserMock);
vi.mock("../src/tools/zhipu-layout-ocr.js", () => ocrMock);
vi.mock("../src/tools/zhipu-vlm.js", () => vlmMock);
vi.mock("../src/tools/pdf-render.js", () => pdfRenderMock);

import { parseMaterialPaths } from "../src/tools/parse-materials.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..");
const envKeys = [
  "CAIXU_PARSE_MODE",
  "CAIXU_ZHIPU_PARSER_MODE",
  "CAIXU_ZHIPU_OCR_ENABLED",
  "CAIXU_ZHIPU_PARSER_API_KEY",
  "CAIXU_ZHIPU_OCR_API_KEY",
  "CAIXU_ZHIPU_VLM_API_KEY",
  "CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS",
  "CAIXU_ZHIPU_HTTP_BASE_DELAY_MS",
  "CAIXU_ZHIPU_HTTP_MAX_DELAY_MS",
  "CAIXU_ZHIPU_MIN_INTERVAL_MS",
  "CAIXU_VLM_MODEL",
  "CAIXU_VLM_PDF_RENDERER",
  "ZHIPU_API_KEY"
] as const;
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
) as Record<(typeof envKeys)[number], string | undefined>;
const tempDirs: string[] = [];

async function createTempFile(fileName: string, content: string | Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "caixu-ocr-mcp-"));
  const filePath = join(directory, fileName);
  tempDirs.push(directory);
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();

  parserMock.parseWithZhipuParser.mockReset();
  ocrMock.runZhipuLayoutOcr.mockReset();
  vlmMock.runZhipuVlmOcr.mockReset();
  pdfRenderMock.renderPdfToPngBuffers.mockReset();

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

describe("@caixu/ocr-mcp parse_materials", () => {
  it("parses local text fixtures", async () => {
    const result = await parseMaterialPaths({
      file_paths: [join(repoRoot, "fixtures", "materials", "transcript.txt")]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_count).toBe(1);
    expect(result.data?.warning_count).toBe(0);
    expect(result.data?.skipped_count).toBe(0);
    expect(result.data?.parsed_files[0]?.parse_status).toBe("parsed");
    expect(result.data?.parsed_files[0]?.provider).toBe("local");
    expect(parserMock.parseWithZhipuParser).not.toHaveBeenCalled();
  });

  it("skips unsupported binaries with structured diagnostics", async () => {
    const binaryPath = await createTempFile("archive.bin", Buffer.from([0x00, 0x01, 0x02]));

    const result = await parseMaterialPaths({
      file_paths: [binaryPath]
    });

    expect(result.status).toBe("partial");
    expect(result.data?.parsed_count).toBe(0);
    expect(result.data?.failed_count).toBe(0);
    expect(result.data?.warning_count).toBe(0);
    expect(result.data?.skipped_count).toBe(1);
    expect(result.data?.skipped_files[0]?.code).toBe("UNSUPPORTED_FILE_SKIPPED");
    expect(result.data?.skipped_files[0]?.file_name).toBe("archive.bin");
  });

  it("keeps binaries as binary_only in local mode", async () => {
    process.env.CAIXU_PARSE_MODE = "local";
    const pdfPath = await createTempFile("scan.pdf", Buffer.from("fake-pdf"));

    const result = await parseMaterialPaths({
      file_paths: [pdfPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.parse_status).toBe("binary_only");
    expect(result.data?.warning_count).toBe(0);
    expect(result.data?.skipped_count).toBe(0);
    expect(parserMock.parseWithZhipuParser).not.toHaveBeenCalled();
    expect(ocrMock.runZhipuLayoutOcr).not.toHaveBeenCalled();
  });

  it("skips office temp lock files instead of treating them as real materials", async () => {
    const tempDocPath = await createTempFile("~$resume.docx", Buffer.from("fake-docx"));

    const result = await parseMaterialPaths({
      file_paths: [tempDocPath]
    });

    expect(result.status).toBe("partial");
    expect(result.data?.parsed_count).toBe(0);
    expect(result.data?.skipped_count).toBe(1);
    expect(result.data?.skipped_files[0]?.code).toBe("OFFICE_TEMP_FILE_SKIPPED");
    expect(parserMock.parseWithZhipuParser).not.toHaveBeenCalled();
  });

  it("routes raw images to paid OCR when enabled", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "true";
    const imagePath = await createTempFile("student-id.png", Buffer.from("fake-image"));
    ocrMock.runZhipuLayoutOcr.mockResolvedValue("Student ID\nName: Demo Student");

    const result = await parseMaterialPaths({
      file_paths: [imagePath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("zhipu_ocr");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("Demo Student");
    expect(result.data?.skipped_count).toBe(0);
    expect(ocrMock.runZhipuLayoutOcr).toHaveBeenCalledTimes(1);
    expect(vlmMock.runZhipuVlmOcr).not.toHaveBeenCalled();
    expect(parserMock.parseWithZhipuParser).not.toHaveBeenCalled();
  });

  it("routes raw images to VLM when paid OCR is disabled", async () => {
    process.env.CAIXU_ZHIPU_VLM_API_KEY = "vlm-key";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "false";
    process.env.CAIXU_VLM_MODEL = "glm-4.6v";
    const imagePath = await createTempFile("student-id.jpg", Buffer.from("fake-image"));
    vlmMock.runZhipuVlmOcr.mockResolvedValue("Student ID\nName: Demo Student");

    const result = await parseMaterialPaths({
      file_paths: [imagePath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("zhipu_vlm");
    expect(result.data?.skipped_count).toBe(0);
    expect(vlmMock.runZhipuVlmOcr).toHaveBeenCalledTimes(1);
    expect(ocrMock.runZhipuLayoutOcr).not.toHaveBeenCalled();
  });

  it("supports split parser and vlm keys without generic ZHIPU_API_KEY", async () => {
    delete process.env.ZHIPU_API_KEY;
    process.env.CAIXU_ZHIPU_PARSER_API_KEY = "parser-key";
    process.env.CAIXU_ZHIPU_VLM_API_KEY = "vlm-key";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "false";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "lite";
    const pdfPath = await createTempFile("scan.pdf", Buffer.from("fake-pdf"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_pdf_lite",
      mode: "lite",
      provider: "zhipu_parser_lite",
      text: "Parser text",
      assets: [],
      branchErrors: []
    });
    pdfRenderMock.renderPdfToPngBuffers.mockResolvedValue([
      {
        fileName: "page-1.png",
        mimeType: "image/png",
        buffer: Buffer.from("page-1")
      }
    ]);
    vlmMock.runZhipuVlmOcr.mockResolvedValue("Page 1 text");

    const result = await parseMaterialPaths({
      file_paths: [pdfPath]
    });

    expect(result.status).toBe("success");
    expect(parserMock.parseWithZhipuParser).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "parser-key" })
    );
    expect(vlmMock.runZhipuVlmOcr).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "vlm-key" })
    );
  });

  it("uses parser lite for office documents when export is disabled", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "lite";
    const docxPath = await createTempFile("resume.docx", Buffer.from("fake-docx"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_docx_lite",
      mode: "lite",
      provider: "zhipu_parser_lite",
      text: "Resume\nDemo Student",
      assets: [],
      branchErrors: []
    });

    const result = await parseMaterialPaths({
      file_paths: [docxPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("zhipu_parser_lite");
    expect(parserMock.parseWithZhipuParser).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "lite",
        fileType: "DOCX"
      })
    );
    expect(ocrMock.runZhipuLayoutOcr).not.toHaveBeenCalled();
    expect(vlmMock.runZhipuVlmOcr).not.toHaveBeenCalled();
  });

  it("uses parser export plus OCR for office image assets", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "export";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "true";
    const docxPath = await createTempFile("portfolio.docx", Buffer.from("fake-docx"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_docx_export",
      mode: "export",
      provider: "zhipu_parser_export",
      text: "Portfolio\nDemo Student",
      assets: [
        {
          fileName: "embedded-1.png",
          mimeType: "image/png",
          buffer: Buffer.from("asset")
        }
      ],
      branchErrors: []
    });
    ocrMock.runZhipuLayoutOcr.mockResolvedValue("Embedded certificate text");

    const result = await parseMaterialPaths({
      file_paths: [docxPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("hybrid");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("Portfolio");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("Embedded certificate text");
  });

  it("uses parser export plus VLM for office image assets when OCR is disabled", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "export";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "false";
    const xlsxPath = await createTempFile("scores.xlsx", Buffer.from("fake-xlsx"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_xlsx_export",
      mode: "export",
      provider: "zhipu_parser_export",
      text: "Scores workbook",
      assets: [
        {
          fileName: "sheet-chart.png",
          mimeType: "image/png",
          buffer: Buffer.from("asset")
        }
      ],
      branchErrors: []
    });
    vlmMock.runZhipuVlmOcr.mockResolvedValue("Chart labels and notes");

    const result = await parseMaterialPaths({
      file_paths: [xlsxPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("hybrid");
    expect(vlmMock.runZhipuVlmOcr).toHaveBeenCalledTimes(1);
  });

  it("uses parser plus direct OCR for PDFs when OCR is enabled", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "lite";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "true";
    const pdfPath = await createTempFile("scan.pdf", Buffer.from("fake-pdf"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_pdf_lite",
      mode: "lite",
      provider: "zhipu_parser_lite",
      text: "Parser text",
      assets: [],
      branchErrors: []
    });
    ocrMock.runZhipuLayoutOcr.mockResolvedValue("OCR text");

    const result = await parseMaterialPaths({
      file_paths: [pdfPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("hybrid");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("Parser text");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("OCR text");
    expect(pdfRenderMock.renderPdfToPngBuffers).not.toHaveBeenCalled();
  });

  it("uses parser plus VLM rendered pages for PDFs when OCR is disabled", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "lite";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "false";
    process.env.CAIXU_VLM_PDF_RENDERER = "pdftocairo";
    const pdfPath = await createTempFile("scan.pdf", Buffer.from("fake-pdf"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_pdf_lite",
      mode: "lite",
      provider: "zhipu_parser_lite",
      text: "Parser text",
      assets: [],
      branchErrors: []
    });
    pdfRenderMock.renderPdfToPngBuffers.mockResolvedValue([
      {
        fileName: "page-1.png",
        mimeType: "image/png",
        buffer: Buffer.from("page-1")
      },
      {
        fileName: "page-2.png",
        mimeType: "image/png",
        buffer: Buffer.from("page-2")
      }
    ]);
    vlmMock.runZhipuVlmOcr
      .mockResolvedValueOnce("Page 1 text")
      .mockResolvedValueOnce("Page 2 text");

    const result = await parseMaterialPaths({
      file_paths: [pdfPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.provider).toBe("hybrid");
    expect(pdfRenderMock.renderPdfToPngBuffers).toHaveBeenCalledWith({
      filePath: pdfPath,
      renderer: "pdftocairo"
    });
    expect(vlmMock.runZhipuVlmOcr).toHaveBeenCalledTimes(2);
  });

  it("returns partial when parser succeeds but supplemental OCR fails", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.CAIXU_ZHIPU_PARSER_MODE = "export";
    process.env.CAIXU_ZHIPU_OCR_ENABLED = "true";
    const docxPath = await createTempFile("proof.docx", Buffer.from("fake-docx"));

    parserMock.parseWithZhipuParser.mockResolvedValue({
      taskId: "task_docx_export",
      mode: "export",
      provider: "zhipu_parser_export",
      text: "Primary parser text",
      assets: [
        {
          fileName: "embedded-1.png",
          mimeType: "image/png",
          buffer: Buffer.from("asset")
        }
      ],
      branchErrors: []
    });
    ocrMock.runZhipuLayoutOcr.mockRejectedValue(
      new Error("remote OCR timeout")
    );

    const result = await parseMaterialPaths({
      file_paths: [docxPath]
    });

    expect(result.status).toBe("partial");
    expect(result.data?.parsed_count).toBe(1);
    expect(result.data?.failed_count).toBe(0);
    expect(result.data?.warning_count).toBe(1);
    expect(result.data?.skipped_count).toBe(0);
    expect(result.data?.parsed_files[0]?.provider).toBe("zhipu_parser_export");
    expect(result.data?.warning_files[0]?.file_id).toBe(result.data?.parsed_files[0]?.file_id);
    expect(result.data?.warning_files[0]?.file_name).toBe("proof.docx");
  });

  it("fails structured when live parsing is required but API key is missing", async () => {
    delete process.env.ZHIPU_API_KEY;
    const docxPath = await createTempFile("resume.docx", Buffer.from("fake-docx"));

    const result = await parseMaterialPaths({
      file_paths: [docxPath]
    });

    expect(result.status).toBe("failed");
    expect(result.data?.parsed_count).toBe(0);
    expect(result.data?.warning_count).toBe(0);
    expect(result.data?.skipped_count).toBe(0);
    expect(result.errors?.[0]?.code).toBe("ZHIPU_API_KEY_MISSING");
  });

  it("marks missing files as failed", async () => {
    const result = await parseMaterialPaths({
      file_paths: [join(repoRoot, "fixtures", "materials", "missing-file.txt")]
    });

    expect(result.status).toBe("failed");
    expect(result.errors?.[0]?.code).toBe("PARSE_MATERIAL_FAILED");
    expect(result.data?.failed_files[0]?.file_name).toBe("missing-file.txt");
    expect(result.data?.skipped_count).toBe(0);
  });
});
