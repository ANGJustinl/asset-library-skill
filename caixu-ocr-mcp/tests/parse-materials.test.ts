import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMaterialPaths } from "../src/tools/parse-materials.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..");
const envKeys = ["CAIXU_PARSE_MODE", "ZHIPU_API_KEY"] as const;
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
  vi.unstubAllGlobals();

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

describe("@caixu/ocr-mcp", () => {
  it("parses local text fixtures", async () => {
    const result = await parseMaterialPaths({
      file_paths: [join(repoRoot, "fixtures", "materials", "transcript.txt")]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_count).toBe(1);
    expect(result.data?.parsed_files[0]?.parse_status).toBe("parsed");
    expect(result.data?.parsed_files[0]?.provider).toBe("local");
  });

  it("uses live OCR for supported image files", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    const imagePath = await createTempFile("student-id.png", Buffer.from("fake-image-bytes"));

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "任务创建成功", task_id: "task_png_001" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "succeeded",
            message: "结果获取成功",
            content: "Student ID\nName: Demo Student\nID: 12345\n",
            task_id: "task_png_001"
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseMaterialPaths({
      file_paths: [imagePath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_count).toBe(1);
    expect(result.data?.failed_count).toBe(0);
    expect(result.data?.parsed_files[0]?.provider).toBe("zhipu");
    expect(result.data?.parsed_files[0]?.parse_status).toBe("parsed");
    expect(result.data?.parsed_files[0]?.extracted_text).toContain("Demo Student");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/files/parser/create");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/files/parser/result/task_png_001/text");
  });

  it("returns structured failure when live OCR fails for one file", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    const pdfPath = await createTempFile("id-card-copy.pdf", Buffer.from("fake-pdf-bytes"));

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "任务创建成功", task_id: "task_pdf_001" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "failed",
            message: "文件无法解析",
            task_id: "task_pdf_001"
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseMaterialPaths({
      file_paths: [
        join(repoRoot, "fixtures", "materials", "transcript.txt"),
        pdfPath
      ]
    });

    expect(result.status).toBe("partial");
    expect(result.data?.parsed_count).toBe(1);
    expect(result.data?.failed_count).toBe(1);
    expect(result.data?.parsed_files[0]?.file_name).toBe("transcript.txt");
    expect(result.errors?.[0]?.code).toBe("ZHIPU_PARSER_FAILED");
  });

  it("treats empty live parse output as structured failure", async () => {
    process.env.ZHIPU_API_KEY = "test-key";
    const pdfPath = await createTempFile("empty-scan.pdf", Buffer.from("fake-pdf-bytes"));

    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "任务创建成功", task_id: "task_pdf_empty_001" }), {
          status: 200
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "succeeded",
            message: "结果获取成功",
            content: "",
            task_id: "task_pdf_empty_001"
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseMaterialPaths({
      file_paths: [pdfPath]
    });

    expect(result.status).toBe("failed");
    expect(result.data?.parsed_count).toBe(0);
    expect(result.errors?.[0]?.code).toBe("ZHIPU_PARSER_EMPTY_CONTENT");
  });

  it("fails structured when live OCR is required but API key is missing", async () => {
    delete process.env.ZHIPU_API_KEY;
    const imagePath = await createTempFile("student-id.png", Buffer.from("fake-image-bytes"));

    const result = await parseMaterialPaths({
      file_paths: [imagePath]
    });

    expect(result.status).toBe("failed");
    expect(result.data?.parsed_count).toBe(0);
    expect(result.data?.failed_count).toBe(1);
    expect(result.errors?.[0]?.code).toBe("ZHIPU_API_KEY_MISSING");
  });

  it("keeps unsupported binaries as binary_only", async () => {
    const binaryPath = await createTempFile("archive.bin", Buffer.from([0x00, 0x01, 0x02]));

    const result = await parseMaterialPaths({
      file_paths: [binaryPath]
    });

    expect(result.status).toBe("success");
    expect(result.data?.parsed_files[0]?.parse_status).toBe("binary_only");
    expect(result.data?.parsed_files[0]?.provider).toBe("local");
  });

  it("marks missing files as failed", async () => {
    const result = await parseMaterialPaths({
      file_paths: [join(repoRoot, "fixtures", "materials", "missing-file.txt")]
    });

    expect(result.status).toBe("failed");
    expect(result.errors?.[0]?.code).toBe("PARSE_MATERIAL_FAILED");
  });
});
