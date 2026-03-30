import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const createEndpoint = "https://open.bigmodel.cn/api/paas/v4/files/parser/create";
const resultEndpoint = "https://open.bigmodel.cn/api/paas/v4/files/parser/result";
const defaultToolType = "lite";
const maxPollAttempts = 30;
const pollIntervalMs = 2000;
const requestTimeoutMs = 30000;

type JsonRecord = Record<string, unknown>;

export class ZhipuParserError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly taskId?: string;

  constructor(input: {
    code: string;
    message: string;
    retryable: boolean;
    taskId?: string;
  }) {
    super(input.message);
    this.name = "ZhipuParserError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.taskId = input.taskId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonSafely(rawText: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    return null;
  }

  return null;
}

function readMessage(payload: JsonRecord | null, fallback: string): string {
  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  return fallback;
}

function readTaskId(payload: JsonRecord | null): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload.task_id === "string" && payload.task_id.trim()) {
    return payload.task_id;
  }

  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    const data = payload.data as JsonRecord;
    if (typeof data.task_id === "string" && data.task_id.trim()) {
      return data.task_id;
    }
  }

  return null;
}

function readContent(payload: JsonRecord | null, rawText: string): string | null {
  if (payload && typeof payload.content === "string") {
    return payload.content;
  }

  if (payload && typeof payload.data === "string") {
    return payload.data;
  }

  const trimmed = rawText.trim();
  if (!payload && trimmed.length > 0) {
    return trimmed;
  }

  return null;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function createTask(input: {
  filePath: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  apiKey: string;
}): Promise<string> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([await readFile(input.filePath)], { type: input.mimeType }),
    input.fileName
  );
  form.set("tool_type", defaultToolType);
  form.set("file_type", input.fileType);

  let response: Response;
  try {
    response = await fetch(createEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`
      },
      body: form,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    throw new ZhipuParserError({
      code: "ZHIPU_PARSER_REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Zhipu create request failed",
      retryable: true
    });
  }

  const rawText = await readResponseText(response);
  const payload = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new ZhipuParserError({
      code: "ZHIPU_PARSER_REQUEST_FAILED",
      message: readMessage(payload, `Zhipu create request failed with status ${response.status}`),
      retryable: response.status >= 500
    });
  }

  const taskId = readTaskId(payload);
  if (!taskId) {
    throw new ZhipuParserError({
      code: "ZHIPU_PARSER_INVALID_RESPONSE",
      message: "Zhipu create response did not include task_id",
      retryable: false
    });
  }

  return taskId;
}

async function pollTask(input: {
  taskId: string;
  apiKey: string;
}): Promise<string> {
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${resultEndpoint}/${input.taskId}/text`, {
        headers: {
          Authorization: `Bearer ${input.apiKey}`
        },
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
    } catch (error) {
      throw new ZhipuParserError({
        code: "ZHIPU_PARSER_REQUEST_FAILED",
        message: error instanceof Error ? error.message : "Zhipu polling request failed",
        retryable: true,
        taskId: input.taskId
      });
    }

    const rawText = await readResponseText(response);
    const payload = parseJsonSafely(rawText);

    if (!response.ok) {
      throw new ZhipuParserError({
        code: "ZHIPU_PARSER_REQUEST_FAILED",
        message: readMessage(payload, `Zhipu polling failed with status ${response.status}`),
        retryable: response.status >= 500,
        taskId: input.taskId
      });
    }

    const status = payload && typeof payload.status === "string" ? payload.status : null;
    if (status === "processing") {
      await sleep(pollIntervalMs);
      continue;
    }

    if (status === "failed") {
      throw new ZhipuParserError({
        code: "ZHIPU_PARSER_FAILED",
        message: readMessage(payload, "Zhipu parser reported failure"),
        retryable: false,
        taskId: input.taskId
      });
    }

    if (status === "succeeded" || status === null) {
      const content = readContent(payload, rawText);
      if (content !== null) {
        if (content.trim().length === 0) {
          throw new ZhipuParserError({
            code: "ZHIPU_PARSER_EMPTY_CONTENT",
            message: "Zhipu parser returned empty text content",
            retryable: false,
            taskId: input.taskId
          });
        }
        return content;
      }

      throw new ZhipuParserError({
        code: "ZHIPU_PARSER_INVALID_RESPONSE",
        message: "Zhipu parser did not return text content",
        retryable: false,
        taskId: input.taskId
      });
    }

    throw new ZhipuParserError({
      code: "ZHIPU_PARSER_INVALID_RESPONSE",
      message: `Unexpected Zhipu parser status: ${status}`,
      retryable: false,
      taskId: input.taskId
    });
  }

  throw new ZhipuParserError({
    code: "ZHIPU_PARSER_TIMEOUT",
    message: `Timed out while waiting for Zhipu parser task ${input.taskId}`,
    retryable: true,
    taskId: input.taskId
  });
}

export async function parseFileWithZhipu(input: {
  filePath: string;
  mimeType: string;
  fileType: string;
  apiKey: string;
}): Promise<string> {
  const taskId = await createTask({
    filePath: input.filePath,
    fileName: basename(input.filePath),
    fileType: input.fileType,
    mimeType: input.mimeType,
    apiKey: input.apiKey
  });

  try {
    return await pollTask({
      taskId,
      apiKey: input.apiKey
    });
  } catch (error) {
    if (error instanceof ZhipuParserError) {
      console.error(
        JSON.stringify({
          message: "caixu-ocr-mcp live parse failed",
          task_id: error.taskId ?? taskId,
          code: error.code,
          error: error.message
        })
      );
    }
    throw error;
  }
}
