#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const skillSpecs = [
  { name: "ingest-materials", dir: "caixu-ingest-materials" },
  { name: "build-asset-library", dir: "caixu-build-asset-library" },
  { name: "maintain-asset-library", dir: "caixu-maintain-asset-library" },
  { name: "query-assets", dir: "caixu-query-assets" },
  { name: "check-lifecycle", dir: "caixu-check-lifecycle" },
  { name: "build-package", dir: "caixu-build-package" },
  { name: "submit-demo", dir: "caixu-submit-demo" }
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function shellString(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseArgs(argv) {
  const defaults = {
    runtimeDir: join(repoRoot, ".runtime"),
    judgeDemoUrl: process.env.CAIXU_JUDGE_DEMO_URL ?? "http://127.0.0.1:3000/judge-demo",
    agentApiKey: process.env.CAIXU_AGENT_API_KEY ?? "",
    agentModel: process.env.CAIXU_AGENT_MODEL ?? "glm-4.6",
    zhipuApiKey: process.env.ZHIPU_API_KEY ?? "",
    zhipuParserApiKey: process.env.CAIXU_ZHIPU_PARSER_API_KEY ?? "",
    zhipuOcrApiKey: process.env.CAIXU_ZHIPU_OCR_API_KEY ?? "",
    zhipuVlmApiKey: process.env.CAIXU_ZHIPU_VLM_API_KEY ?? "",
    parseMode: process.env.CAIXU_PARSE_MODE ?? "auto",
    fileBatchSize: process.env.CAIXU_FILE_BATCH_SIZE ?? "6",
    remoteParseConcurrency: process.env.CAIXU_REMOTE_PARSE_CONCURRENCY ?? "2",
    buildAssetMaxRetries: process.env.CAIXU_BUILD_ASSET_MAX_RETRIES ?? "2",
    cliProgress: process.env.CAIXU_CLI_PROGRESS ?? "true",
    cliHeartbeatMs: process.env.CAIXU_CLI_HEARTBEAT_MS ?? "5000",
    zhipuParserMode: process.env.CAIXU_ZHIPU_PARSER_MODE ?? "lite",
    agentTimeoutMs: process.env.CAIXU_AGENT_TIMEOUT_MS ?? "60000",
    agentHttpMaxAttempts: process.env.CAIXU_AGENT_HTTP_MAX_ATTEMPTS ?? "4",
    agentHttpBaseDelayMs: process.env.CAIXU_AGENT_HTTP_BASE_DELAY_MS ?? "2000",
    agentHttpMaxDelayMs: process.env.CAIXU_AGENT_HTTP_MAX_DELAY_MS ?? "20000",
    agentMinIntervalMs: process.env.CAIXU_AGENT_MIN_INTERVAL_MS ?? "1500",
    zhipuOcrEnabled: process.env.CAIXU_ZHIPU_OCR_ENABLED ?? "false",
    vlmModel: process.env.CAIXU_VLM_MODEL ?? "glm-4.6v",
    vlmPdfRenderer: process.env.CAIXU_VLM_PDF_RENDERER ?? "pdftoppm",
    zhipuHttpMaxAttempts: process.env.CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS ?? "4",
    zhipuHttpBaseDelayMs: process.env.CAIXU_ZHIPU_HTTP_BASE_DELAY_MS ?? "2000",
    zhipuHttpMaxDelayMs: process.env.CAIXU_ZHIPU_HTTP_MAX_DELAY_MS ?? "20000",
    zhipuMinIntervalMs: process.env.CAIXU_ZHIPU_MIN_INTERVAL_MS ?? "1500",
    skipInstall: false,
    skipVerify: false,
    skipSmoke: false,
    mergeMcpConfig: "",
    mcpConfigOut: "",
    skillsManifestOut: "",
    envFile: "",
    sqlitePath: "",
    reportOut: ""
  };

  const options = { ...defaults };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }
    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (arg === "--skip-verify") {
      options.skipVerify = true;
      continue;
    }
    if (arg === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }
    if (arg === "--runtime-dir") {
      options.runtimeDir = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--judge-demo-url") {
      options.judgeDemoUrl = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-api-key") {
      options.agentApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-model") {
      options.agentModel = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-api-key") {
      options.zhipuApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-parser-api-key") {
      options.zhipuParserApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-ocr-api-key") {
      options.zhipuOcrApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-vlm-api-key") {
      options.zhipuVlmApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--parse-mode") {
      options.parseMode = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-parser-mode") {
      options.zhipuParserMode = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--cli-progress") {
      options.cliProgress = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--cli-heartbeat-ms") {
      options.cliHeartbeatMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-ocr-enabled") {
      options.zhipuOcrEnabled = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-http-max-attempts") {
      options.agentHttpMaxAttempts = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-http-base-delay-ms") {
      options.agentHttpBaseDelayMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-http-max-delay-ms") {
      options.agentHttpMaxDelayMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--agent-min-interval-ms") {
      options.agentMinIntervalMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--vlm-model") {
      options.vlmModel = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--vlm-pdf-renderer") {
      options.vlmPdfRenderer = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-http-max-attempts") {
      options.zhipuHttpMaxAttempts = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-http-base-delay-ms") {
      options.zhipuHttpBaseDelayMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-http-max-delay-ms") {
      options.zhipuHttpMaxDelayMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-min-interval-ms") {
      options.zhipuMinIntervalMs = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--merge-mcp-config") {
      options.mergeMcpConfig = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--mcp-config-out") {
      options.mcpConfigOut = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--skills-manifest-out") {
      options.skillsManifestOut = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--sqlite-path") {
      options.sqlitePath = resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--report-out") {
      options.reportOut = resolve(next ?? "");
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  const dataDir = join(options.runtimeDir, "data");
  const logsDir = join(options.runtimeDir, "logs");
  const binDir = join(options.runtimeDir, "bin");

  return {
    ...options,
    dataDir,
    logsDir,
    binDir,
    sqlitePath: options.sqlitePath || join(dataDir, "caixu.sqlite"),
    envFile: options.envFile || join(options.runtimeDir, "caixu.env"),
    mcpConfigOut: options.mcpConfigOut || join(options.runtimeDir, "caixu.mcp.json"),
    skillsManifestOut:
      options.skillsManifestOut || join(options.runtimeDir, "caixu.skills.json"),
    reportOut: options.reportOut || join(options.runtimeDir, "caixu.install.json")
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/install-caixu.mjs [options]

Options:
  --runtime-dir PATH         Runtime root directory. Default: <repo>/.runtime
  --sqlite-path PATH         SQLite file path. Default: <runtime>/data/caixu.sqlite
  --env-file PATH            Generated shell env file path
  --mcp-config-out PATH      Generated MCP config fragment path
  --skills-manifest-out PATH Generated skills manifest path
  --merge-mcp-config PATH    Merge generated MCP servers into an existing JSON file
  --judge-demo-url URL       Judge demo URL
  --agent-api-key KEY        Agent model API key
  --agent-model MODEL        Agent model code. Default: glm-4.6
  --zhipu-api-key KEY        Zhipu API key
  --zhipu-parser-api-key KEY Parser API key. Falls back to ZHIPU_API_KEY
  --zhipu-ocr-api-key KEY    OCR API key. Falls back to parser key or ZHIPU_API_KEY
  --zhipu-vlm-api-key KEY    VLM API key. Falls back to ZHIPU_API_KEY
  --parse-mode MODE          Parse mode. Default: auto
  --zhipu-parser-mode MODE   Parser mode: lite | export
  --cli-progress BOOL        Enable append-only progress.jsonl output: true | false
  --cli-heartbeat-ms N       Heartbeat interval for progress.jsonl. Default: 5000
  --zhipu-ocr-enabled BOOL   Enable paid layout_parsing OCR: true | false
  --agent-http-max-attempts N
  --agent-http-base-delay-ms N
  --agent-http-max-delay-ms N
  --agent-min-interval-ms N
  --vlm-model MODEL          VLM fallback model. Default: glm-4.6v
  --vlm-pdf-renderer NAME    PDF renderer: pdftoppm | pdftocairo
  --zhipu-http-max-attempts N
  --zhipu-http-base-delay-ms N
  --zhipu-http-max-delay-ms N
  --zhipu-min-interval-ms N
  --skip-install             Skip pnpm install
  --skip-verify             Skip pnpm test/typecheck/build
  --skip-smoke              Skip pnpm smoke:agent
  --help                    Show this help
`);
}

function requireCommand(command, versionArgs = ["--version"]) {
  const result = spawnSync(command, versionArgs, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail(`Required command not found or not runnable: ${command}`);
  }
  return String(result.stdout ?? "").trim();
}

function requireNode24() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    fail(`Node 24+ is required. Current version: ${process.versions.node}`);
  }
}

function requirePnpm10(versionText) {
  const major = Number.parseInt(String(versionText).split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 10) {
    fail(`pnpm 10+ is required. Current version: ${versionText}`);
  }
}

function runCommand(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...options.env }
  });
}

function ensureDir(pathname) {
  mkdirSync(pathname, { recursive: true });
}

function validateRepoShape() {
  const requiredFiles = [
    "package.json",
    "caixu-ocr-mcp/package.json",
    "caixu-data-mcp/package.json"
  ];

  for (const relativePath of requiredFiles) {
    const absolutePath = join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      fail(`Required repository file is missing: ${absolutePath}`);
    }
  }

  for (const skill of skillSpecs) {
    const skillFile = join(repoRoot, skill.dir, "SKILL.md");
    if (!existsSync(skillFile)) {
      fail(`Required skill file is missing: ${skillFile}`);
    }
  }
}

function writeExecutable(pathname, content) {
  writeFileSync(pathname, content, "utf8");
  chmodSync(pathname, 0o755);
}

function buildEnvFileContent(options) {
  return `export CAIXU_PARSE_MODE=${shellString(options.parseMode)}
export CAIXU_FILE_BATCH_SIZE=${shellString(options.fileBatchSize)}
export CAIXU_REMOTE_PARSE_CONCURRENCY=${shellString(options.remoteParseConcurrency)}
export CAIXU_BUILD_ASSET_MAX_RETRIES=${shellString(options.buildAssetMaxRetries)}
export CAIXU_CLI_PROGRESS=${shellString(options.cliProgress)}
export CAIXU_CLI_HEARTBEAT_MS=${shellString(options.cliHeartbeatMs)}
export CAIXU_AGENT_MODEL=${shellString(options.agentModel)}
export CAIXU_AGENT_TIMEOUT_MS=${shellString(options.agentTimeoutMs)}
export CAIXU_AGENT_HTTP_MAX_ATTEMPTS=${shellString(options.agentHttpMaxAttempts)}
export CAIXU_AGENT_HTTP_BASE_DELAY_MS=${shellString(options.agentHttpBaseDelayMs)}
export CAIXU_AGENT_HTTP_MAX_DELAY_MS=${shellString(options.agentHttpMaxDelayMs)}
export CAIXU_AGENT_MIN_INTERVAL_MS=${shellString(options.agentMinIntervalMs)}
export CAIXU_AGENT_API_KEY=${shellString(options.agentApiKey)}
export CAIXU_ZHIPU_PARSER_MODE=${shellString(options.zhipuParserMode)}
export CAIXU_ZHIPU_OCR_ENABLED=${shellString(options.zhipuOcrEnabled)}
export CAIXU_VLM_MODEL=${shellString(options.vlmModel)}
export CAIXU_VLM_PDF_RENDERER=${shellString(options.vlmPdfRenderer)}
export CAIXU_ZHIPU_HTTP_MAX_ATTEMPTS=${shellString(options.zhipuHttpMaxAttempts)}
export CAIXU_ZHIPU_HTTP_BASE_DELAY_MS=${shellString(options.zhipuHttpBaseDelayMs)}
export CAIXU_ZHIPU_HTTP_MAX_DELAY_MS=${shellString(options.zhipuHttpMaxDelayMs)}
export CAIXU_ZHIPU_MIN_INTERVAL_MS=${shellString(options.zhipuMinIntervalMs)}
export CAIXU_ZHIPU_PARSER_API_KEY=${shellString(options.zhipuParserApiKey)}
export CAIXU_ZHIPU_OCR_API_KEY=${shellString(options.zhipuOcrApiKey)}
export CAIXU_ZHIPU_VLM_API_KEY=${shellString(options.zhipuVlmApiKey)}
export ZHIPU_API_KEY=${shellString(options.zhipuApiKey)}
export CAIXU_SQLITE_PATH=${shellString(options.sqlitePath)}
export CAIXU_JUDGE_DEMO_URL=${shellString(options.judgeDemoUrl)}
`;
}

function writeLaunchScripts(options) {
  const ocrScript = join(options.binDir, "start-ocr-mcp.sh");
  const dataScript = join(options.binDir, "start-data-mcp.sh");
  const commonPrefix = `#!/usr/bin/env bash
set -euo pipefail

ROOT=${shellString(repoRoot)}
ENV_FILE=${shellString(options.envFile)}

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi
`;

  writeExecutable(
    ocrScript,
    `${commonPrefix}
exec node "$ROOT/caixu-ocr-mcp/dist/index.js"
`
  );

  writeExecutable(
    dataScript,
    `${commonPrefix}
exec node "$ROOT/caixu-data-mcp/dist/index.js"
`
  );

  return { ocrScript, dataScript };
}

function buildMcpConfig(launchScripts) {
  return {
    mcpServers: {
      "caixu-ocr-mcp": {
        command: launchScripts.ocrScript,
        args: []
      },
      "caixu-data-mcp": {
        command: launchScripts.dataScript,
        args: []
      }
    }
  };
}

function mergeMcpConfig(targetPath, generatedConfig) {
  const targetDir = dirname(targetPath);
  ensureDir(targetDir);

  let base = {};
  if (existsSync(targetPath)) {
    const current = readFileSync(targetPath, "utf8");
    base = current.trim() ? JSON.parse(current) : {};
  }

  if (!base || typeof base !== "object" || Array.isArray(base)) {
    fail(`Cannot merge MCP config into non-object JSON file: ${targetPath}`);
  }

  const merged = {
    ...base,
    mcpServers: {
      ...(base.mcpServers ?? {}),
      ...generatedConfig.mcpServers
    }
  };

  writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

function buildSkillsManifest() {
  return {
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    skills: skillSpecs.map((spec) => ({
      name: spec.name,
      directory: join(repoRoot, spec.dir),
      skill_file: join(repoRoot, spec.dir, "SKILL.md")
    }))
  };
}

function buildReport(options, launchScripts) {
  return {
    status: "success",
    generated_at: new Date().toISOString(),
    repo_root: repoRoot,
    runtime_dir: options.runtimeDir,
    data_dir: options.dataDir,
    logs_dir: options.logsDir,
    sqlite_path: options.sqlitePath,
    env_file: options.envFile,
    mcp_config_out: options.mcpConfigOut,
    merged_mcp_config: options.mergeMcpConfig || null,
    skills_manifest_out: options.skillsManifestOut,
    launch_scripts: {
      ocr: launchScripts.ocrScript,
      data: launchScripts.dataScript
    },
    skills: skillSpecs.map((spec) => ({
      name: spec.name,
      directory: join(repoRoot, spec.dir)
    })),
    verification: {
      install_ran: !options.skipInstall,
      verify_ran: !options.skipVerify,
      smoke_ran: !options.skipSmoke
    },
    next_steps: [
      `source ${options.envFile}`,
      `bash ${launchScripts.ocrScript}`,
      `bash ${launchScripts.dataScript}`,
      `Import ${options.mcpConfigOut} or merge it into your AutoClaw/OpenClaw MCP config.`,
      `Register the 6 skills listed in ${options.skillsManifestOut}.`
    ]
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  requireNode24();
  requirePnpm10(requireCommand("pnpm"));
  if (!options.skipVerify || !options.skipSmoke) {
    requireCommand("unzip", ["-v"]);
  }
  validateRepoShape();

  ensureDir(options.runtimeDir);
  ensureDir(options.dataDir);
  ensureDir(options.logsDir);
  ensureDir(options.binDir);

  writeFileSync(options.envFile, buildEnvFileContent(options), "utf8");
  const launchScripts = writeLaunchScripts(options);

  const mcpConfig = buildMcpConfig(launchScripts);
  writeFileSync(options.mcpConfigOut, `${JSON.stringify(mcpConfig, null, 2)}\n`, "utf8");
  writeFileSync(
    options.skillsManifestOut,
    `${JSON.stringify(buildSkillsManifest(), null, 2)}\n`,
    "utf8"
  );

  if (!options.skipInstall) {
    runCommand("pnpm", ["install"]);
  }

  if (!options.skipVerify) {
    runCommand("pnpm", ["test"]);
    runCommand("pnpm", ["typecheck"]);
    runCommand("pnpm", ["build"]);
  } else if (!options.skipSmoke) {
    runCommand("pnpm", ["build"]);
  }

  if (!options.skipSmoke) {
    runCommand("pnpm", ["smoke:agent"]);
  }

  if (options.mergeMcpConfig) {
    mergeMcpConfig(options.mergeMcpConfig, mcpConfig);
  }

  const report = buildReport(options, launchScripts);
  writeFileSync(options.reportOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
