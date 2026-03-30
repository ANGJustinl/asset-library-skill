#!/usr/bin/env node

import {
  detectAutoClawInstallation,
  ensureDirectory,
  resolveRuntimeConfig,
  runDoctorSuite,
  writeJson
} from "./lib/autoclaw-helpers.mjs";

function parseArgs(argv) {
  const options = {
    autoClawHome: process.env.CAIXU_AUTOCLAW_HOME ?? ""
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
    if (arg === "--autoclaw-home") {
      options.autoClawHome = next ?? "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  pnpm autoclaw:doctor -- [options]

Options:
  --autoclaw-home PATH   Explicit AutoClaw profile directory. Default: ~/.openclaw-autoclaw
  --help                 Show this help
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const paths = detectAutoClawInstallation(options.autoClawHome);
  ensureDirectory(paths.runtimeDir);

  const runtimeConfig = resolveRuntimeConfig(paths);
  const report = await runDoctorSuite(paths, runtimeConfig);
  writeJson(paths.doctorReportPath, report);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "blocked") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("autoclaw doctor failed:", error);
  process.exit(1);
});
