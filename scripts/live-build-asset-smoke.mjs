import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const inputRoot = process.argv.slice(2).filter((arg) => arg !== "--")[0];

function exitWithUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: pnpm smoke:live-build-asset -- /ABS/PATH/input-dir"
  );
  process.exit(1);
}

function getEnvValue(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function ensureRequiredEnv(input) {
  const agentKey = getEnvValue("CAIXU_AGENT_API_KEY", "ZHIPU_API_KEY");
  if (!agentKey) {
    throw new Error(
      "Missing CAIXU_AGENT_API_KEY or ZHIPU_API_KEY for live build-asset smoke."
    );
  }

  const parserKey = getEnvValue("CAIXU_ZHIPU_PARSER_API_KEY", "ZHIPU_API_KEY");
  if (!parserKey) {
    throw new Error(
      "Missing CAIXU_ZHIPU_PARSER_API_KEY or ZHIPU_API_KEY for live parser access."
    );
  }

  const ocrEnabled = !["0", "false", "no", "off"].includes(
    String(input.CAIXU_ZHIPU_OCR_ENABLED ?? "true").trim().toLowerCase()
  );
  if (ocrEnabled) {
    const ocrKey = getEnvValue("CAIXU_ZHIPU_OCR_API_KEY", "ZHIPU_API_KEY");
    if (!ocrKey) {
      throw new Error(
        "Missing CAIXU_ZHIPU_OCR_API_KEY or ZHIPU_API_KEY while CAIXU_ZHIPU_OCR_ENABLED=true."
      );
    }
  } else {
    const vlmKey = getEnvValue("CAIXU_ZHIPU_VLM_API_KEY", "ZHIPU_API_KEY");
    if (!vlmKey) {
      throw new Error(
        "Missing CAIXU_ZHIPU_VLM_API_KEY or ZHIPU_API_KEY while CAIXU_ZHIPU_OCR_ENABLED=false."
      );
    }
  }
}

if (!inputRoot) {
  exitWithUsage();
}

const resolvedInputRoot = path.resolve(inputRoot);
if (!fs.existsSync(resolvedInputRoot)) {
  exitWithUsage(`Input directory does not exist: ${resolvedInputRoot}`);
}
if (!fs.statSync(resolvedInputRoot).isDirectory()) {
  exitWithUsage(`Input path is not a directory: ${resolvedInputRoot}`);
}

const env = {
  ...process.env,
  CAIXU_PARSE_MODE: process.env.CAIXU_PARSE_MODE ?? "auto",
  CAIXU_FILE_BATCH_SIZE: process.env.CAIXU_FILE_BATCH_SIZE ?? "1",
  CAIXU_REMOTE_PARSE_CONCURRENCY:
    process.env.CAIXU_REMOTE_PARSE_CONCURRENCY ?? "1",
  CAIXU_BUILD_ASSET_MAX_RETRIES:
    process.env.CAIXU_BUILD_ASSET_MAX_RETRIES ?? "1",
  CAIXU_BUILD_FAILURE_STREAK_LIMIT:
    process.env.CAIXU_BUILD_FAILURE_STREAK_LIMIT ?? "2",
  CAIXU_BUILD_RATE_LIMIT_FAILURE_LIMIT:
    process.env.CAIXU_BUILD_RATE_LIMIT_FAILURE_LIMIT ?? "1",
  CAIXU_INGEST_ROUTE_FALLBACK_TO_SUGGESTED:
    process.env.CAIXU_INGEST_ROUTE_FALLBACK_TO_SUGGESTED ?? "true",
  CAIXU_CLI_PROGRESS: process.env.CAIXU_CLI_PROGRESS ?? "true",
  CAIXU_CLI_HEARTBEAT_MS: process.env.CAIXU_CLI_HEARTBEAT_MS ?? "3000",
  CAIXU_AGENT_MODEL: process.env.CAIXU_AGENT_MODEL ?? "glm-4.6",
  CAIXU_AGENT_TIMEOUT_MS: process.env.CAIXU_AGENT_TIMEOUT_MS ?? "60000",
  CAIXU_AGENT_HTTP_MAX_ATTEMPTS:
    process.env.CAIXU_AGENT_HTTP_MAX_ATTEMPTS ?? "2",
  CAIXU_AGENT_HTTP_BASE_DELAY_MS:
    process.env.CAIXU_AGENT_HTTP_BASE_DELAY_MS ?? "2000",
  CAIXU_AGENT_HTTP_MAX_DELAY_MS:
    process.env.CAIXU_AGENT_HTTP_MAX_DELAY_MS ?? "20000",
  CAIXU_AGENT_MIN_INTERVAL_MS:
    process.env.CAIXU_AGENT_MIN_INTERVAL_MS ?? "1500",
  CAIXU_ZHIPU_PARSER_MODE: process.env.CAIXU_ZHIPU_PARSER_MODE ?? "lite",
  CAIXU_ZHIPU_OCR_ENABLED: process.env.CAIXU_ZHIPU_OCR_ENABLED ?? "true",
  CAIXU_VLM_MODEL: process.env.CAIXU_VLM_MODEL ?? "glm-4.6v",
  CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS:
    process.env.CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS ?? "5",
  CAIXU_ZHIPU_HTTP_BASE_DELAY_MS:
    process.env.CAIXU_ZHIPU_HTTP_BASE_DELAY_MS ?? "2000",
  CAIXU_ZHIPU_HTTP_MAX_DELAY_MS:
    process.env.CAIXU_ZHIPU_HTTP_MAX_DELAY_MS ?? "20000",
  CAIXU_ZHIPU_MIN_INTERVAL_MS:
    process.env.CAIXU_ZHIPU_MIN_INTERVAL_MS ?? "1500"
};

try {
  ensureRequiredEnv(env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.error(
  `[caixu-live] starting live build-asset smoke for ${resolvedInputRoot}`
);

const child = spawn(
  process.execPath,
  ["scripts/real-folder-smoke.mjs", resolvedInputRoot],
  {
    cwd: path.join(import.meta.dirname, ".."),
    env,
    stdio: "inherit"
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
