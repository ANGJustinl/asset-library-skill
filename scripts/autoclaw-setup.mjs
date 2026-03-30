#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  buildMcporterAddArgs,
  buildEnvFileContent,
  buildIssue,
  buildMcpServerSpecs,
  detectAutoClawInstallation,
  ensureDirectory,
  inspectSkillLink,
  mcpEntriesEqual,
  readConfiguredMcpServer,
  repoRoot,
  replaceWithSymlink,
  resolveRuntimeConfig,
  resolveStatus,
  runDoctorSuite,
  runProcess,
  skillSpecs,
  summarizeRuntimeConfig,
  writeJson
} from "./lib/autoclaw-helpers.mjs";

function parseArgs(argv) {
  const options = {
    autoClawHome: process.env.CAIXU_AUTOCLAW_HOME ?? "",
    judgeDemoUrl: process.env.CAIXU_JUDGE_DEMO_URL ?? "",
    zhipuApiKey: process.env.ZHIPU_API_KEY ?? "",
    sqlitePath: process.env.CAIXU_SQLITE_PATH ?? "",
    parseMode: process.env.CAIXU_PARSE_MODE ?? "",
    yes: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    if (arg === "--autoclaw-home") {
      options.autoClawHome = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--judge-demo-url") {
      options.judgeDemoUrl = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--zhipu-api-key") {
      options.zhipuApiKey = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--sqlite-path") {
      options.sqlitePath = next ?? "";
      index += 1;
      continue;
    }
    if (arg === "--parse-mode") {
      options.parseMode = next ?? "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  pnpm autoclaw:setup -- [options]

Options:
  --autoclaw-home PATH   Explicit AutoClaw profile directory. Default: ~/.openclaw-autoclaw
  --judge-demo-url URL   Judge demo URL
  --zhipu-api-key KEY    Zhipu API key for live OCR
  --sqlite-path PATH     SQLite file path
  --parse-mode MODE      Parse mode. Default: auto
  --yes                  Non-interactive mode. Use defaults and overwrite after prompting logic
  --help                 Show this help
`);
}

async function promptText(rl, message, defaultValue, options = {}) {
  if (options.yes) {
    return defaultValue;
  }

  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const raw = await rl.question(`${message}${suffix}: `);
  if (!raw.trim()) {
    return defaultValue;
  }
  return raw.trim();
}

async function promptSecret(rl, message, maskedValue, fallbackValue, options = {}) {
  if (options.yes) {
    return fallbackValue;
  }

  const suffix = maskedValue ? ` [${maskedValue}]` : "";
  const raw = await rl.question(`${message}${suffix}: `);
  if (!raw.trim()) {
    return fallbackValue;
  }
  return raw.trim();
}

async function promptConfirm(rl, message, defaultYes, options = {}) {
  if (options.yes) {
    return defaultYes;
  }

  const hint = defaultYes ? "Y/n" : "y/N";
  const raw = (await rl.question(`${message} [${hint}]: `)).trim().toLowerCase();
  if (!raw) {
    return defaultYes;
  }
  return raw === "y" || raw === "yes";
}

function commandMissing(commandResult) {
  return !commandResult.ok;
}

function runRepoCommand(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
}

function buildSetupReport(paths, runtimeConfig, actions, issues, doctorReport) {
  return {
    status: resolveStatus([...issues, ...(doctorReport?.issues ?? [])]),
    generated_at: new Date().toISOString(),
    paths: {
      repo_root: repoRoot,
      autoclaw_home: paths.autoClawHome,
      autoclaw_config_path: paths.openClawConfigPath,
      managed_skills_dir: paths.managedSkillsDir,
      mcporter_config_path: paths.mcporterConfigPath,
      runtime_dir: paths.runtimeDir,
      env_file: paths.envFilePath,
      setup_report: paths.setupReportPath,
      doctor_report: paths.doctorReportPath
    },
    runtime_config: summarizeRuntimeConfig(runtimeConfig),
    actions,
    issues,
    doctor_status: doctorReport?.status ?? "blocked",
    next_steps:
      doctorReport?.status === "success"
        ? [
            "AutoClaw and mcporter are configured. Open AutoClaw and verify the six Caixu skills are available.",
            `If you change env vars later, edit ${paths.envFilePath} and rerun pnpm autoclaw:doctor.`
          ]
        : [
            `Read ${paths.doctorReportPath} to see remaining blocking issues.`,
            "Fix the listed issues, then rerun pnpm autoclaw:doctor."
          ]
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const paths = detectAutoClawInstallation(options.autoClawHome);
  ensureDirectory(paths.runtimeDir);
  ensureDirectory(paths.runtimeDataDir);

  const rl = createInterface({ input: stdin, output: stdout });
  const issues = [];
  const actions = [];

  try {
    const baseRuntime = resolveRuntimeConfig(paths, {
      judgeDemoUrl: options.judgeDemoUrl || undefined,
      zhipuApiKey: options.zhipuApiKey || undefined,
      sqlitePath: options.sqlitePath || undefined,
      parseMode: options.parseMode || undefined
    });

    const commandChecks = [
      { name: "node", result: runProcess("node", ["--version"]) },
      { name: "pnpm", result: runProcess("pnpm", ["--version"]) },
      { name: "openclaw", result: runProcess("openclaw", ["--version"], { homeRoot: paths.homeRoot }) },
      { name: "mcporter", result: runProcess("mcporter", ["--version"], { homeRoot: paths.homeRoot }) }
    ];

    for (const check of commandChecks) {
      if (commandMissing(check.result)) {
        issues.push(
          buildIssue(
            "error",
            "COMMAND_MISSING",
            `Required command is missing or not runnable: ${check.name}`,
            `Install ${check.name} and rerun pnpm autoclaw:setup.`
          )
        );
      }
    }

    if (issues.some((issue) => issue.severity === "error")) {
      const partialReport = buildSetupReport(paths, baseRuntime, actions, issues, null);
      writeJson(paths.setupReportPath, partialReport);
      console.log(JSON.stringify(partialReport, null, 2));
      process.exit(1);
    }

    const configFileResult = runProcess(
      "openclaw",
      ["--profile", "autoclaw", "config", "file"],
      { homeRoot: paths.homeRoot }
    );
    actions.push({
      step: "detect_profile",
      ok: configFileResult.ok,
      detail: (configFileResult.stdout || configFileResult.stderr).trim()
    });

    const validateBefore = runProcess(
      "openclaw",
      ["--profile", "autoclaw", "config", "validate"],
      { homeRoot: paths.homeRoot }
    );
    if (!validateBefore.ok) {
      if (options.yes) {
        issues.push(
          buildIssue(
            "error",
            "AUTOCLAW_PROFILE_INVALID",
            "AutoClaw profile is missing or invalid. Non-interactive setup cannot complete onboard automatically.",
            "Run openclaw --profile autoclaw onboard, then rerun pnpm autoclaw:setup -- --yes."
          )
        );
        const partialReport = buildSetupReport(paths, baseRuntime, actions, issues, null);
        writeJson(paths.setupReportPath, partialReport);
        console.log(JSON.stringify(partialReport, null, 2));
        process.exit(1);
      }

      const shouldOnboard = await promptConfirm(
        rl,
        "AutoClaw profile is missing or invalid. Run openclaw --profile autoclaw onboard now?",
        true,
        options
      );
      if (!shouldOnboard) {
        issues.push(
          buildIssue(
            "error",
            "AUTOCLAW_PROFILE_INVALID",
            "AutoClaw profile is missing or invalid, and onboarding was skipped.",
            "Run openclaw --profile autoclaw onboard, then rerun pnpm autoclaw:setup."
          )
        );
        const partialReport = buildSetupReport(paths, baseRuntime, actions, issues, null);
        writeJson(paths.setupReportPath, partialReport);
        console.log(JSON.stringify(partialReport, null, 2));
        process.exit(1);
      }

      console.log("> openclaw --profile autoclaw onboard");
      const onboardResult = runProcess(
        "openclaw",
        ["--profile", "autoclaw", "onboard"],
        { homeRoot: paths.homeRoot, inherit: true }
      );
      actions.push({
        step: "onboard_profile",
        ok: onboardResult.ok,
        detail: "Ran openclaw --profile autoclaw onboard"
      });

      const validateAfter = runProcess(
        "openclaw",
        ["--profile", "autoclaw", "config", "validate"],
        { homeRoot: paths.homeRoot }
      );
      if (!validateAfter.ok) {
        issues.push(
          buildIssue(
            "error",
            "AUTOCLAW_PROFILE_STILL_INVALID",
            "AutoClaw profile is still invalid after onboarding.",
            "Inspect openclaw.json and rerun pnpm autoclaw:doctor."
          )
        );
        const partialReport = buildSetupReport(paths, baseRuntime, actions, issues, null);
        writeJson(paths.setupReportPath, partialReport);
        console.log(JSON.stringify(partialReport, null, 2));
        process.exit(1);
      }
    }

    const distEntrypoints = [
      "caixu-ocr-mcp/dist/index.js",
      "caixu-data-mcp/dist/index.js"
    ];
    const missingDist = distEntrypoints.filter((relativePath) => !existsSync(`${repoRoot}/${relativePath}`));
    if (missingDist.length > 0) {
      const shouldBuild = await promptConfirm(
        rl,
        `Missing build outputs:\n${missingDist.join("\n")}\nRun pnpm install (if needed) and pnpm build now?`,
        true,
        options
      );
      if (!shouldBuild) {
        issues.push(
          buildIssue(
            "error",
            "DIST_ENTRYPOINT_MISSING",
            "Required dist entrypoints are missing and build was skipped.",
            "Run pnpm install && pnpm build, then rerun pnpm autoclaw:setup."
          )
        );
        const partialReport = buildSetupReport(paths, baseRuntime, actions, issues, null);
        writeJson(paths.setupReportPath, partialReport);
        console.log(JSON.stringify(partialReport, null, 2));
        process.exit(1);
      }

      if (!existsSync(`${repoRoot}/node_modules`)) {
        runRepoCommand("pnpm", ["install"]);
        actions.push({ step: "pnpm_install", ok: true });
      }
      runRepoCommand("pnpm", ["build"]);
      actions.push({ step: "pnpm_build", ok: true });
    }

    const runtimeConfig = {
      ...baseRuntime,
      parseMode: await promptText(rl, "CAIXU_PARSE_MODE", baseRuntime.parseMode, options),
      judgeDemoUrl: await promptText(
        rl,
        "CAIXU_JUDGE_DEMO_URL",
        baseRuntime.judgeDemoUrl,
        options
      ),
      sqlitePath: await promptText(
        rl,
        "CAIXU_SQLITE_PATH",
        baseRuntime.sqlitePath,
        options
      ),
      zhipuApiKey: await promptSecret(
        rl,
        "ZHIPU_API_KEY",
        baseRuntime.zhipuApiKey ? `${baseRuntime.zhipuApiKey.slice(0, 4)}***` : "",
        baseRuntime.zhipuApiKey,
        options
      )
    };

    ensureDirectory(paths.runtimeDir);
    ensureDirectory(paths.runtimeDataDir);
    writeFileSync(paths.envFilePath, buildEnvFileContent(runtimeConfig), "utf8");
    actions.push({
      step: "write_env_file",
      ok: true,
      detail: paths.envFilePath
    });

    const mcpSpecs = buildMcpServerSpecs(paths, runtimeConfig);
    for (const spec of mcpSpecs) {
      const current = readConfiguredMcpServer(paths.homeRoot, spec.name);
      if (current && mcpEntriesEqual(current, spec)) {
        actions.push({
          step: "register_mcp",
          ok: true,
          detail: `${spec.name} already matches expected config.`
        });
        continue;
      }

      if (current && !mcpEntriesEqual(current, spec)) {
        const shouldReplace = await promptConfirm(
          rl,
          `${spec.name} already exists in mcporter home config with different settings. Replace it?`,
          true,
          options
        );
        if (!shouldReplace) {
          issues.push(
            buildIssue(
              "warning",
              "MCP_SERVER_REPLACE_SKIPPED",
              `Skipped replacing existing mcporter entry for ${spec.name}.`,
              "Rerun pnpm autoclaw:setup or edit the mcporter home config manually if this server fails."
            )
          );
          actions.push({
            step: "register_mcp",
            ok: false,
            detail: `Skipped replacement for ${spec.name}.`
          });
          continue;
        }
      }

      const addResult = runProcess("mcporter", buildMcporterAddArgs(spec), {
        homeRoot: paths.homeRoot
      });
      actions.push({
        step: "register_mcp",
        ok: addResult.ok,
        detail: addResult.ok
          ? `Registered ${spec.name} in mcporter home config.`
          : (addResult.stderr || addResult.stdout).trim()
      });
      if (!addResult.ok) {
        issues.push(
          buildIssue(
            "error",
            "MCP_SERVER_REGISTER_FAILED",
            `Failed to register ${spec.name} in mcporter home config.`,
            `Inspect ${paths.mcporterConfigPath} and rerun pnpm autoclaw:setup.`
          )
        );
      }
    }

    ensureDirectory(paths.managedSkillsDir);
    for (const skillSpec of skillSpecs) {
      const targetDir = `${paths.managedSkillsDir}/${skillSpec.name}`;
      const status = inspectSkillLink(targetDir, skillSpec.sourceDir);
      if (status.status === "correct_symlink" || status.status === "correct_directory") {
        actions.push({
          step: "link_skill",
          ok: true,
          detail: `${skillSpec.name} already linked.`
        });
        continue;
      }

      if (status.status === "wrong_symlink" || status.status === "occupied_path") {
        const shouldReplace = await promptConfirm(
          rl,
          `Skill path ${targetDir} already exists and conflicts with ${skillSpec.sourceDir}. Replace it with a symlink?`,
          true,
          options
        );
        if (!shouldReplace) {
          issues.push(
            buildIssue(
              "warning",
              "SKILL_REPLACE_SKIPPED",
              `Skipped replacing managed skill path for ${skillSpec.name}.`,
              `Replace ${targetDir} manually or rerun pnpm autoclaw:setup.`
            )
          );
          actions.push({
            step: "link_skill",
            ok: false,
            detail: `Skipped replacing ${skillSpec.name}.`
          });
          continue;
        }
      }

      replaceWithSymlink(targetDir, skillSpec.sourceDir);
      actions.push({
        step: "link_skill",
        ok: true,
        detail: `${skillSpec.name} -> ${skillSpec.sourceDir}`
      });
    }

    const doctorReport = await runDoctorSuite(paths, runtimeConfig);
    writeJson(paths.doctorReportPath, doctorReport);
    const setupReport = buildSetupReport(paths, runtimeConfig, actions, issues, doctorReport);
    writeJson(paths.setupReportPath, setupReport);
    console.log(JSON.stringify(setupReport, null, 2));
    if (setupReport.status === "blocked") {
      process.exitCode = 1;
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("autoclaw setup failed:", error);
  process.exit(1);
});
