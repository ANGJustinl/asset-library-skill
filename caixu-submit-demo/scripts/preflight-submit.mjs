#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packagePlanPath = process.argv[2];
const profilePath = process.argv[3];
const allowRiskySubmit = process.argv[4] === "true";

if (!packagePlanPath || !profilePath) {
  fail("Usage: node preflight-submit.mjs <packagePlan.json> <submissionProfile.json> [allowRiskySubmit]");
}

const packagePlan = JSON.parse(readFileSync(packagePlanPath, "utf8"));
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

if (!packagePlan?.generated_files?.length) {
  fail("Package plan does not contain generated_files.");
}

const zipEntry = packagePlan.generated_files.find((file) => file.file_type === "zip");
if (!zipEntry) {
  fail("Package plan does not include a zip artifact.");
}

if (zipEntry.path && !existsSync(resolve(zipEntry.path))) {
  fail(`Package zip does not exist: ${zipEntry.path}`);
}

if (!allowRiskySubmit && packagePlan?.readiness?.ready_for_submission !== true) {
  fail("Package readiness blocks submission.");
}

if (!profile || typeof profile !== "object") {
  fail("Submission profile must be an object.");
}

console.log(JSON.stringify({ ok: true }));
