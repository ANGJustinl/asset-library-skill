import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runZhipuLayoutOcr } from "../src/tools/zhipu-layout-ocr.js";
import { parseWithZhipuParser } from "../src/tools/zhipu-file-parser.js";

const envKeys = [
  "CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS",
  "CAIXU_ZHIPU_HTTP_BASE_DELAY_MS",
  "CAIXU_ZHIPU_HTTP_MAX_DELAY_MS",
  "CAIXU_ZHIPU_MIN_INTERVAL_MS"
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
) as Record<(typeof envKeys)[number], string | undefined>;

const tempDirs: string[] = [];

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

async function createTempBinaryFile(fileName: string, content: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "caixu-zhipu-retry-"));
  tempDirs.push(directory);
  const filePath = join(directory, fileName);
  await writeFile(filePath, content);
  return filePath;
}

describe("@caixu/ocr-mcp zhipu retry helpers", () => {
  it("retries 429 layout OCR responses before succeeding", async () => {
    process.env.CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS = "2";
    process.env.CAIXU_ZHIPU_HTTP_BASE_DELAY_MS = "10";
    process.env.CAIXU_ZHIPU_HTTP_MAX_DELAY_MS = "10";
    process.env.CAIXU_ZHIPU_MIN_INTERVAL_MS = "0";

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            md_results: "Demo OCR Text"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const events: Array<{ event: string; status_code: number | null }> = [];
    const text = await runZhipuLayoutOcr({
      apiKey: "ocr-key",
      buffer: Buffer.from("fake-image"),
      mimeType: "image/png",
      onEvent(event) {
        events.push({
          event: event.event,
          status_code: event.status_code
        });
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).toBe("Demo OCR Text");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "http.retry_scheduled",
          status_code: 429
        }),
        expect.objectContaining({
          event: "http.cooldown_wait"
        })
      ])
    );
  });

  it("retries 429 parser polling responses before succeeding", async () => {
    process.env.CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS = "2";
    process.env.CAIXU_ZHIPU_HTTP_BASE_DELAY_MS = "10";
    process.env.CAIXU_ZHIPU_HTTP_MAX_DELAY_MS = "10";
    process.env.CAIXU_ZHIPU_MIN_INTERVAL_MS = "0";

    const filePath = await createTempBinaryFile("sample.docx", Buffer.from("fake-docx"));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: "task_demo"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "succeeded",
            content: "Parser text"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const events: Array<{ event: string; status_code: number | null }> = [];
    const result = await parseWithZhipuParser({
      filePath,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileType: "DOCX",
      apiKey: "parser-key",
      mode: "lite",
      onEvent(event) {
        events.push({
          event: event.event,
          status_code: event.status_code
        });
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe("zhipu_parser_lite");
    expect(result.text).toBe("Parser text");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "http.retry_scheduled",
          status_code: 429
        }),
        expect.objectContaining({
          event: "http.cooldown_wait"
        })
      ])
    );
  });
});
