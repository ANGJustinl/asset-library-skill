#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "../..");
export const defaultJudgeDemoUrl = "http://127.0.0.1:3000/judge-demo";
export const defaultParseMode = "auto";
export const expectedSkillNames = [
  "ingest-materials",
  "build-asset-library",
  "query-assets",
  "check-lifecycle",
  "build-package",
  "submit-demo"
];

export const skillSpecs = expectedSkillNames.map((name) => ({
  name,
  sourceDir: join(repoRoot, `caixu-${name}`),
  skillFile: join(repoRoot, `caixu-${name}`, "SKILL.md")
}));

function toAbsolutePath(pathname) {
  return pathname ? resolve(pathname) : pathname;
}

function pathExists(pathname) {
  return Boolean(pathname) && existsSync(pathname);
}

function fileExists(pathname) {
  return pathExists(pathname) && lstatSync(pathname).isFile();
}

function directoryExists(pathname) {
  return pathExists(pathname) && lstatSync(pathname).isDirectory();
}

function dedupePaths(paths) {
  const seen = new Set();
  return paths.filter((pathname) => {
    if (!pathname) {
      return false;
    }
    const key = resolve(pathname);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getConfigMtime(pathname) {
  const configPath = join(pathname, "openclaw.json");
  if (!fileExists(configPath)) {
    return 0;
  }
  return lstatSync(configPath).mtimeMs;
}

function buildCandidate(pathname, source) {
  const absolutePath = toAbsolutePath(pathname);
  return {
    path: absolutePath,
    source,
    exists: pathExists(absolutePath),
    hasConfig: fileExists(join(absolutePath, "openclaw.json")),
    managedSkillsDirExists: directoryExists(join(absolutePath, "skills")),
    configMtimeMs: getConfigMtime(absolutePath)
  };
}

function chooseAutoClawHome(candidates, preferredPath) {
  if (preferredPath) {
    return candidates.find((candidate) => candidate.path === preferredPath) ?? buildCandidate(preferredPath, "user");
  }

  const standard = candidates.find((candidate) => candidate.source === "default-home");
  if (standard?.hasConfig) {
    return standard;
  }

  const withConfig = candidates
    .filter((candidate) => candidate.exists && candidate.hasConfig)
    .sort((left, right) => right.configMtimeMs - left.configMtimeMs);
  if (withConfig[0]) {
    return withConfig[0];
  }

  if (standard?.exists) {
    return standard;
  }

  return (
    candidates.find((candidate) => candidate.exists) ??
    standard ??
    buildCandidate(join(homedir(), ".openclaw-autoclaw"), "default-home")
  );
}

export function detectAutoClawInstallation(preferredHome = "") {
  const normalizedPreferred = preferredHome ? toAbsolutePath(preferredHome) : "";
  const standardHome = join(homedir(), ".openclaw-autoclaw");
  const candidatePaths = dedupePaths([normalizedPreferred, standardHome]);

  const candidates = candidatePaths.map((pathname) => {
    if (pathname === normalizedPreferred) {
      return buildCandidate(pathname, "user");
    }
    if (pathname === standardHome) {
      return buildCandidate(pathname, "default-home");
    }
    return buildCandidate(pathname, "custom");
  });

  const selected = chooseAutoClawHome(candidates, normalizedPreferred);
  const homeRoot = dirname(selected.path);
  const runtimeDir = join(selected.path, "caixu-runtime");

  return {
    selectedSource: selected.source,
    autoClawHome: selected.path,
    homeRoot,
    openClawConfigPath: join(selected.path, "openclaw.json"),
    managedSkillsDir: join(selected.path, "skills"),
    runtimeDir,
    runtimeDataDir: join(runtimeDir, "data"),
    runtimeReportsDir: runtimeDir,
    envFilePath: join(runtimeDir, "caixu.env"),
    setupReportPath: join(runtimeDir, "setup-report.json"),
    doctorReportPath: join(runtimeDir, "doctor-report.json"),
    mcporterConfigPath: join(homeRoot, ".mcporter", "mcporter.json"),
    fixtureTranscriptPath: join(repoRoot, "fixtures/materials/transcript.txt"),
    fixturePngPath: join(repoRoot, "fixtures/materials/ocr-smoke.png"),
    candidates
  };
}

export function ensureDirectory(pathname) {
  mkdirSync(pathname, { recursive: true });
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export function buildEnvFileContent(config) {
  return [
    `export CAIXU_PARSE_MODE=${shellQuote(config.parseMode ?? defaultParseMode)}`,
    `export ZHIPU_API_KEY=${shellQuote(config.zhipuApiKey ?? "")}`,
    `export CAIXU_SQLITE_PATH=${shellQuote(config.sqlitePath)}`,
    `export CAIXU_JUDGE_DEMO_URL=${shellQuote(config.judgeDemoUrl ?? defaultJudgeDemoUrl)}`,
    ""
  ].join("\n");
}

function parseShellValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1).replace(/'"'"'/g, "'");
  }
  return value;
}

export function readEnvFile(pathname) {
  if (!fileExists(pathname)) {
    return {};
  }

  const entries = {};
  const source = readFileSync(pathname, "utf8");
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/u);
    if (!match) {
      continue;
    }
    entries[match[1]] = parseShellValue(match[2]);
  }
  return entries;
}

export function maskSecret(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function resolveRuntimeConfig(paths, overrides = {}) {
  const existingEnv = readEnvFile(paths.envFilePath);
  const parseMode =
    overrides.parseMode ??
    process.env.CAIXU_PARSE_MODE ??
    existingEnv.CAIXU_PARSE_MODE ??
    defaultParseMode;
  const zhipuApiKey =
    overrides.zhipuApiKey ??
    process.env.ZHIPU_API_KEY ??
    existingEnv.ZHIPU_API_KEY ??
    "";
  const sqlitePath =
    overrides.sqlitePath ??
    process.env.CAIXU_SQLITE_PATH ??
    existingEnv.CAIXU_SQLITE_PATH ??
    join(paths.runtimeDataDir, "caixu.sqlite");
  const judgeDemoUrl =
    overrides.judgeDemoUrl ??
    process.env.CAIXU_JUDGE_DEMO_URL ??
    existingEnv.CAIXU_JUDGE_DEMO_URL ??
    defaultJudgeDemoUrl;

  return {
    parseMode,
    zhipuApiKey,
    sqlitePath: toAbsolutePath(sqlitePath),
    judgeDemoUrl,
    envFileValues: existingEnv
  };
}

export function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...(options.homeRoot ? { HOME: options.homeRoot } : {}),
      ...(options.env ?? {})
    },
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    input: options.input
  });

  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? 1,
    stdout: options.inherit ? "" : String(result.stdout ?? ""),
    stderr: options.inherit ? "" : String(result.stderr ?? ""),
    error: result.error ? String(result.error.message ?? result.error) : ""
  };
}

export function collectCommandVersions(homeRoot = "") {
  const checks = [
    { name: "node", args: ["--version"] },
    { name: "pnpm", args: ["--version"] },
    { name: "openclaw", args: ["--version"] },
    { name: "mcporter", args: ["--version"] }
  ];

  return checks.map((check) => {
    const result = runProcess(check.name, check.args, { homeRoot });
    return {
      command: check.name,
      ok: result.ok,
      version: (result.stdout || result.stderr).trim(),
      status: result.status
    };
  });
}

export function buildMcpServerSpecs(_runtimePaths, runtimeConfig) {
  return [
    {
      name: "caixu-ocr-mcp",
      command: "node",
      args: [join(repoRoot, "caixu-ocr-mcp", "dist", "index.js")],
      env: {
        CAIXU_PARSE_MODE: runtimeConfig.parseMode,
        ...(runtimeConfig.zhipuApiKey
          ? { ZHIPU_API_KEY: runtimeConfig.zhipuApiKey }
          : {})
      }
    },
    {
      name: "caixu-data-mcp",
      command: "node",
      args: [join(repoRoot, "caixu-data-mcp", "dist", "index.js")],
      env: {
        CAIXU_SQLITE_PATH: runtimeConfig.sqlitePath,
        CAIXU_JUDGE_DEMO_URL: runtimeConfig.judgeDemoUrl
      }
    }
  ];
}

export function normalizeMcpServerEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const env = entry.env && typeof entry.env === "object" ? { ...entry.env } : {};
  return {
    command: entry.command ? String(entry.command) : "",
    args,
    env
  };
}

export function mcpEntriesEqual(left, right) {
  const normalizedLeft = normalizeMcpServerEntry(left);
  const normalizedRight = normalizeMcpServerEntry(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function readMcporterConfig(pathname) {
  if (!fileExists(pathname)) {
    return { mcpServers: {}, imports: [] };
  }

  const raw = readFileSync(pathname, "utf8").trim();
  if (!raw) {
    return { mcpServers: {}, imports: [] };
  }

  const parsed = JSON.parse(raw);
  return {
    mcpServers:
      parsed && typeof parsed === "object" && parsed.mcpServers && !Array.isArray(parsed.mcpServers)
        ? parsed.mcpServers
        : {},
    imports:
      parsed && typeof parsed === "object" && Array.isArray(parsed.imports)
        ? parsed.imports
        : []
  };
}

export function readConfiguredMcpServer(homeRoot, name) {
  const result = runProcess("mcporter", ["config", "get", name, "--json"], {
    homeRoot
  });
  if (!result.ok) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return normalizeMcpServerEntry(parsed);
  } catch {
    return null;
  }
}

export function buildMcporterAddArgs(spec) {
  const args = [
    "config",
    "add",
    spec.name,
    "--scope",
    "home",
    "--command",
    spec.command
  ];

  for (const arg of spec.args) {
    args.push("--arg", arg);
  }
  for (const [key, value] of Object.entries(spec.env)) {
    args.push("--env", `${key}=${value}`);
  }

  return args;
}

export function inspectSkillLink(targetDir, sourceDir) {
  if (!pathExists(targetDir)) {
    return {
      status: "missing",
      targetDir,
      sourceDir
    };
  }

  const stat = lstatSync(targetDir);
  if (stat.isSymbolicLink()) {
    const linkTarget = readlinkSync(targetDir);
    const resolvedTarget = resolve(dirname(targetDir), linkTarget);
    const matches = resolve(resolvedTarget) === resolve(sourceDir);
    return {
      status: matches ? "correct_symlink" : "wrong_symlink",
      targetDir,
      sourceDir,
      linkTarget,
      resolvedTarget
    };
  }

  try {
    const matches = realpathSync(targetDir) === realpathSync(sourceDir);
    return {
      status: matches ? "correct_directory" : "occupied_path",
      targetDir,
      sourceDir
    };
  } catch {
    return {
      status: "occupied_path",
      targetDir,
      sourceDir
    };
  }
}

export function replaceWithSymlink(targetDir, sourceDir) {
  if (pathExists(targetDir)) {
    const stat = lstatSync(targetDir);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      rmSync(targetDir, { recursive: true, force: true });
    } else {
      unlinkSync(targetDir);
    }
  }

  ensureDirectory(dirname(targetDir));
  symlinkSync(sourceDir, targetDir, "dir");
}

export function ensureWritableFilePath(pathname) {
  try {
    const parent = dirname(pathname);
    ensureDirectory(parent);
    const probePath = join(parent, `.caixu-write-check-${process.pid}.tmp`);
    writeFileSync(probePath, "ok\n", "utf8");
    rmSync(probePath, { force: true });
    return { ok: true, message: "" };
  } catch (error) {
    return {
      ok: false,
      message: String(error instanceof Error ? error.message : error)
    };
  }
}

export async function checkUrlReachable(url) {
  if (!url) {
    return {
      ok: false,
      status: 0,
      message: "CAIXU_JUDGE_DEMO_URL is empty."
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok
        ? `Reachable: HTTP ${response.status}`
        : `Endpoint returned HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: String(error instanceof Error ? error.message : error)
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function buildIssue(severity, code, message, fix = "") {
  return {
    severity,
    code,
    message,
    ...(fix ? { fix } : {})
  };
}

export function resolveStatus(issues) {
  if (issues.some((issue) => issue.severity === "error")) {
    return "blocked";
  }
  if (issues.length > 0) {
    return "partial";
  }
  return "success";
}

export function writeJson(pathname, value) {
  ensureDirectory(dirname(pathname));
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function summarizeRuntimeConfig(runtimeConfig) {
  return {
    parse_mode: runtimeConfig.parseMode,
    zhipu_api_key: maskSecret(runtimeConfig.zhipuApiKey),
    sqlite_path: runtimeConfig.sqlitePath,
    judge_demo_url: runtimeConfig.judgeDemoUrl
  };
}

export async function runDoctorSuite(paths, runtimeConfig) {
  const issues = [];
  ensureDirectory(paths.runtimeDir);

  const commandVersions = collectCommandVersions(paths.homeRoot);
  for (const version of commandVersions) {
    if (!version.ok) {
      issues.push(
        buildIssue(
          "error",
          `${version.command.toUpperCase()}_MISSING`,
          `Required command is missing or not runnable: ${version.command}`,
          `Install ${version.command} and rerun pnpm autoclaw:doctor.`
        )
      );
    }
  }

  const mcpSpecs = buildMcpServerSpecs(paths, runtimeConfig);
  const distChecks = mcpSpecs.map((spec) => ({
    name: spec.name,
    entrypoint: spec.args[0],
    exists: fileExists(spec.args[0])
  }));

  for (const distCheck of distChecks) {
    if (!distCheck.exists) {
      issues.push(
        buildIssue(
          "error",
          "DIST_ENTRYPOINT_MISSING",
          `${distCheck.name} entrypoint is missing: ${distCheck.entrypoint}`,
          "Run pnpm build before registering MCP servers."
        )
      );
    }
  }

  const validateResult = runProcess(
    "openclaw",
    ["--profile", "autoclaw", "config", "validate"],
    { homeRoot: paths.homeRoot }
  );
  if (!validateResult.ok) {
    issues.push(
      buildIssue(
        "error",
        "AUTOCLAW_PROFILE_INVALID",
        (validateResult.stderr || validateResult.stdout).trim() ||
          "AutoClaw profile validation failed.",
        "Run openclaw --profile autoclaw onboard, then rerun setup."
      )
    );
  }

  const skillsCheck = runProcess(
    "openclaw",
    ["--profile", "autoclaw", "skills", "check"],
    { homeRoot: paths.homeRoot }
  );
  const skillsList = runProcess(
    "openclaw",
    ["--profile", "autoclaw", "skills", "list", "--json"],
    { homeRoot: paths.homeRoot }
  );

  const parsedSkillsList = safeJsonParse(skillsList.stdout, {});
  const listedSkillNames = Array.isArray(parsedSkillsList?.skills)
    ? parsedSkillsList.skills.map((skill) => String(skill.name))
    : [];

  for (const skillName of expectedSkillNames) {
    const targetDir = join(paths.managedSkillsDir, skillName);
    const linkStatus = inspectSkillLink(targetDir, join(repoRoot, `caixu-${skillName}`));
    const acceptableSkillNames = new Set([skillName, `caixu-${skillName}`]);
    if (linkStatus.status === "missing") {
      issues.push(
        buildIssue(
          "error",
          "SKILL_MISSING",
          `Managed skill is missing: ${skillName}`,
          `Run pnpm autoclaw:setup to link ${skillName} into ${paths.managedSkillsDir}.`
        )
      );
    } else if (linkStatus.status === "wrong_symlink" || linkStatus.status === "occupied_path") {
      issues.push(
        buildIssue(
          "error",
          "SKILL_CONFLICT",
          `Managed skill path is occupied or points elsewhere: ${targetDir}`,
          `Replace ${targetDir} with a symlink to ${join(repoRoot, `caixu-${skillName}`)}.`
        )
      );
    } else if (
      skillsList.ok &&
      !listedSkillNames.some((listedName) => acceptableSkillNames.has(listedName))
    ) {
      issues.push(
        buildIssue(
          "warning",
          "SKILL_NOT_LISTED",
          `Skill symlink exists but openclaw skills list does not show ${skillName} or caixu-${skillName}.`,
          "Run openclaw --profile autoclaw skills check and inspect SKILL.md formatting."
        )
      );
    }
  }

  const mcporterDoctor = runProcess("mcporter", ["config", "doctor"], {
    homeRoot: paths.homeRoot
  });
  const mcporterList = runProcess("mcporter", ["config", "list", "--json"], {
    homeRoot: paths.homeRoot
  });

  const parsedMcporterList = safeJsonParse(mcporterList.stdout, { servers: [] });
  const listedServers = Array.isArray(parsedMcporterList?.servers)
    ? parsedMcporterList.servers.map((server) => String(server.name ?? server))
    : [];

  const registeredServers = {};
  for (const spec of mcpSpecs) {
    const current = readConfiguredMcpServer(paths.homeRoot, spec.name);
    registeredServers[spec.name] = current;
    if (!current) {
      issues.push(
        buildIssue(
          "error",
          "MCP_SERVER_MISSING",
          `mcporter home config does not contain ${spec.name}.`,
          "Run pnpm autoclaw:setup to register the missing MCP server."
        )
      );
      continue;
    }
    if (!mcpEntriesEqual(current, spec)) {
      issues.push(
        buildIssue(
          "warning",
          "MCP_SERVER_DIFFERS",
          `${spec.name} is registered, but its command/env differ from the expected Caixu config.`,
          `Replace ${spec.name} in ${paths.mcporterConfigPath} or rerun pnpm autoclaw:setup.`
        )
      );
    }
    if (!listedServers.includes(spec.name)) {
      issues.push(
        buildIssue(
          "warning",
          "MCP_NOT_LISTED",
          `mcporter config list does not show ${spec.name}.`,
          "Inspect mcporter home config and rerun doctor."
        )
      );
    }
  }

  const sqliteCheck = ensureWritableFilePath(runtimeConfig.sqlitePath);
  if (!sqliteCheck.ok) {
    issues.push(
      buildIssue(
        "error",
        "SQLITE_PATH_NOT_WRITABLE",
        `SQLite path is not writable: ${runtimeConfig.sqlitePath}. ${sqliteCheck.message}`,
        "Choose another CAIXU_SQLITE_PATH or fix directory permissions."
      )
    );
  }

  if (!runtimeConfig.zhipuApiKey) {
    issues.push(
      buildIssue(
        "warning",
        "ZHIPU_API_KEY_MISSING",
        "ZHIPU_API_KEY is empty. Text parsing still works, but png/jpg/jpeg/pdf live parsing will fail.",
        "Set ZHIPU_API_KEY in caixu.env and rerun setup or doctor."
      )
    );
  }

  const judgeUrlCheck = await checkUrlReachable(runtimeConfig.judgeDemoUrl);
  if (!judgeUrlCheck.ok) {
    issues.push(
      buildIssue(
        "warning",
        "JUDGE_DEMO_URL_UNREACHABLE",
        `Judge demo URL check failed: ${judgeUrlCheck.message}`,
        "Fix CAIXU_JUDGE_DEMO_URL or ensure the demo page is reachable from this machine."
      )
    );
  }

  const smokeResults = {
    create_or_load_library: null,
    parse_materials_text: null,
    parse_materials_live_png: null
  };

  const canRunSmoke =
    mcpSpecs.every((spec) => fileExists(spec.args[0])) &&
    registeredServers["caixu-data-mcp"] &&
    registeredServers["caixu-ocr-mcp"];

  if (canRunSmoke) {
    const dataSmoke = runProcess(
      "mcporter",
      [
        "call",
        "caixu-data-mcp.create_or_load_library",
        "owner_hint=autoclaw-doctor",
        "--output",
        "json"
      ],
      { homeRoot: paths.homeRoot }
    );
    smokeResults.create_or_load_library = {
      ok: dataSmoke.ok,
      status: dataSmoke.status,
      response: safeJsonParse(dataSmoke.stdout, null),
      stderr: dataSmoke.stderr.trim()
    };
    if (!dataSmoke.ok) {
      issues.push(
        buildIssue(
          "error",
          "DATA_MCP_SMOKE_FAILED",
          "mcporter call caixu-data-mcp.create_or_load_library failed.",
          "Inspect the data MCP entrypoint, SQLite path, and mcporter registration."
        )
      );
    }

    const textFixtureExists = fileExists(paths.fixtureTranscriptPath);
    if (textFixtureExists) {
      const ocrTextSmoke = runProcess(
        "mcporter",
        [
          "call",
          "caixu-ocr-mcp.parse_materials",
          "--args",
          JSON.stringify({ file_paths: [paths.fixtureTranscriptPath] }),
          "--output",
          "json"
        ],
        { homeRoot: paths.homeRoot }
      );
      smokeResults.parse_materials_text = {
        ok: ocrTextSmoke.ok,
        status: ocrTextSmoke.status,
        response: safeJsonParse(ocrTextSmoke.stdout, null),
        stderr: ocrTextSmoke.stderr.trim()
      };
      if (!ocrTextSmoke.ok) {
        issues.push(
          buildIssue(
            "error",
            "OCR_MCP_TEXT_SMOKE_FAILED",
            "mcporter call caixu-ocr-mcp.parse_materials failed on transcript.txt.",
            "Inspect the OCR MCP registration and local fixture path."
          )
        );
      }
    } else {
      issues.push(
        buildIssue(
          "warning",
          "SMOKE_FIXTURE_MISSING",
          `Missing text smoke fixture: ${paths.fixtureTranscriptPath}`,
          "Restore fixtures/materials/transcript.txt in the repo."
        )
      );
    }

    if (runtimeConfig.zhipuApiKey && fileExists(paths.fixturePngPath)) {
      const liveSmoke = runProcess(
        "mcporter",
        [
          "call",
          "caixu-ocr-mcp.parse_materials",
          "--args",
          JSON.stringify({ file_paths: [paths.fixturePngPath] }),
          "--output",
          "json"
        ],
        { homeRoot: paths.homeRoot }
      );
      smokeResults.parse_materials_live_png = {
        ok: liveSmoke.ok,
        status: liveSmoke.status,
        response: safeJsonParse(liveSmoke.stdout, null),
        stderr: liveSmoke.stderr.trim()
      };
      if (!liveSmoke.ok) {
        issues.push(
          buildIssue(
            "warning",
            "OCR_MCP_LIVE_SMOKE_FAILED",
            "Live OCR smoke on fixtures/materials/ocr-smoke.png failed.",
            "Check ZHIPU_API_KEY, network access, and the OCR MCP live parser."
          )
        );
      }
    }
  }

  return {
    status: resolveStatus(issues),
    generated_at: new Date().toISOString(),
    paths: {
      repo_root: repoRoot,
      autoclaw_home: paths.autoClawHome,
      home_root: paths.homeRoot,
      autoclaw_config_path: paths.openClawConfigPath,
      managed_skills_dir: paths.managedSkillsDir,
      mcporter_config_path: paths.mcporterConfigPath,
      runtime_dir: paths.runtimeDir,
      env_file: paths.envFilePath,
      doctor_report: paths.doctorReportPath
    },
    selected_autoclaw_source: paths.selectedSource,
    detected_autoclaw_homes: paths.candidates,
    runtime_config: summarizeRuntimeConfig(runtimeConfig),
    command_versions: commandVersions,
    dist_checks: distChecks,
    cli: {
      openclaw_config_validate: validateResult,
      openclaw_skills_check: skillsCheck,
      openclaw_skills_list: skillsList.ok
        ? {
            ok: true,
            status: skillsList.status,
            managedSkillsDir: parsedSkillsList?.managedSkillsDir ?? "",
            listedSkillNames
          }
        : {
            ok: false,
            status: skillsList.status,
            stderr: skillsList.stderr.trim() || skillsList.stdout.trim()
          },
      mcporter_config_doctor: mcporterDoctor,
      mcporter_config_list: mcporterList.ok
        ? {
            ok: true,
            status: mcporterList.status,
            listedServers
          }
        : {
            ok: false,
            status: mcporterList.status,
            stderr: mcporterList.stderr.trim() || mcporterList.stdout.trim()
          }
    },
    registered_servers: Object.fromEntries(
      Object.entries(registeredServers).map(([name, entry]) => [
        name,
        entry
          ? {
              command: entry.command,
              args: entry.args,
              env: Object.fromEntries(
                Object.entries(entry.env ?? {}).map(([key, value]) => [
                  key,
                  key.includes("KEY") ? maskSecret(String(value)) : value
                ])
              )
            }
          : null
      ])
    ),
    judge_demo_check: judgeUrlCheck,
    smoke: smokeResults,
    issues
  };
}
