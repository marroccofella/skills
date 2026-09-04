#!/usr/bin/env node
// Portable MyAutoness contract test plus an optional live reference proof.
//
//   node scripts/selftest.mjs --version
//   node scripts/selftest.mjs --self-test [--reference <project-root>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  evaluateObservationPreflight,
  runSelfTest as runObservationPreflightSelfTest,
  sha256Canonical,
} from "./observation-preflight.mjs";

const VERSION = "1.2.0";
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invokedSkillRoot = process.argv[1]
  ? path.resolve(path.dirname(process.argv[1]), "..")
  : skillRoot;
const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write(`myautoness ${VERSION}\n`);
  process.exit(0);
}

if (!args.includes("--self-test")) {
  process.stdout.write(
    "Usage: node scripts/selftest.mjs [--version | --self-test [--reference <project-root>]]\n",
  );
  process.exit(1);
}

const referenceIndex = args.indexOf("--reference");
if (referenceIndex >= 0 && !args[referenceIndex + 1]) {
  process.stderr.write("--reference requires a project-root path\n");
  process.exit(1);
}

const docPath = path.join(skillRoot, "SKILL.md");
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
const observationReferencePath = path.join(
  skillRoot,
  "references",
  "observation-contract.md",
);
const observationReference = fs.existsSync(observationReferencePath)
  ? fs.readFileSync(observationReferencePath, "utf8")
  : "";
const tests = {
  skill_doc_present: doc.length > 0,
  version_matches_skill_document: new RegExp(`Version ${VERSION.replace(/\./g, "\\.")}(?:\\s|\\()`).test(doc),
  canonical_identity: /^name: myautoness$/m.test(doc) && doc.includes("legacy alias"),
  honest_terminology:
    doc.includes("NOT a neural network") &&
    doc.includes("classical AI") &&
    doc.includes("does **not** mean a machine-learning model"),
  portable_reference: !/[A-Za-z]:\\/.test(doc) && doc.includes("--reference <checkout>"),
  anchored_selftest:
    doc.includes(".agents\\skills\\myautoness\\scripts\\selftest.mjs") &&
    doc.includes(".agents/skills/myautoness/scripts/selftest.mjs"),
  lesson_migration:
    doc.includes("Use `.myautoness/` for new lesson stores") &&
    doc.includes("`.autopilot/`") &&
    doc.includes("copy all schema-valid legacy lessons") &&
    doc.includes("`MIGRATED` marker"),
  lesson_schema_version: doc.includes("`schemaVersion: 1`"),
  lesson_content_binding: /engine\/content (?:version or )?hash/i.test(doc),
  hash_scope: doc.includes("deterministic engine, rules and level/content data"),
  verifier_is_read_only: doc.includes("replay verifier is read-only"),
  redaction_required: /Before writing any lesson, redact or omit passwords/i.test(doc),
  bounded_search:
    doc.includes("60 attempts or 60 seconds per subgoal") &&
    /3,600 attempts or\s+15 minutes per session/i.test(doc),
  bounded_observation: /ten\s+attempts per subgoal and thirty per session/i.test(doc),
  abort_cleanup: doc.includes("user abort, or exception") && doc.includes("finally"),
  overclaim_guard: doc.includes("unbeatable within the searched space"),
  safety_limits_present:
    /CAPTCHA/i.test(doc) && /credentials/i.test(doc) && /irreversibl/i.test(doc),
  assisted_records_rule: doc.includes("assisted records"),
  both_modes_documented: doc.includes("Mode 1") && doc.includes("Mode 2"),
  episode_preflight_documented:
    doc.includes("Control:") &&
    doc.includes("Visibility:") &&
    doc.includes("Observation coherence:") &&
    doc.includes("blocked result means **zero gameplay episodes**"),
  environment_notes_separated:
    doc.includes("environment-recovery") &&
    doc.includes("outside the verified lesson collection"),
  observation_reference_present:
    observationReference.includes("## Target binding") &&
    observationReference.includes("## Environment-recovery diagnostic") &&
    observationReference.includes("## Real-time tasks"),
  preflight_is_linter_not_proof:
    /helper is a contract linter/i.test(doc) &&
    /cannot prove that supplied\s+observations are truthful/.test(doc),
  recovery_budget_is_bounded:
    doc.includes("Preflight and environment-recovery trials consume") &&
    /not a\s+new uncounted retry pool/.test(doc),
  passing_preflight_is_not_gameplay:
    doc.includes("only `preflight-passed`") &&
    doc.includes("not a candidate gameplay trace"),
};

Object.assign(tests, runObservationPreflightSelfTest());

const observationCli = path.join(invokedSkillRoot, "scripts", "observation-preflight.mjs");
const cliTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myautoness-selftest-"));
try {
  const invalidJsonPath = path.join(cliTestRoot, "invalid.json");
  const incompletePath = path.join(cliTestRoot, "incomplete.json");
  const passingPath = path.join(cliTestRoot, "passing.json");
  const diagnosticPath = path.join(cliTestRoot, "diagnostic.json");
  const missingPath = path.join(cliTestRoot, "missing.json");
  const sourceFields = { targetUrl: "https://example.test/cli", observerVersion: VERSION };
  const targetBinding = {
    evidenceClass: "direct",
    identity: "CLI self-test target",
    contentIdentity: {
      algorithm: "sha256",
      canonicalization: "json-sorted-keys-v1",
      sourceFields,
      digest: sha256Canonical(sourceFields),
    },
  };
  const passingInput = {
    schemaVersion: 1,
    targetBinding,
    actionRequirements: { requiresHold: false },
    control: {
      evidenceClass: "direct",
      responseObserved: true,
      actionId: "tap-start",
      action: "tap start",
      beforeState: { hud: "waiting" },
      afterState: { hud: "started" },
      changedFields: ["hud"],
      evidence: "HUD changed",
    },
    visibility: {
      evidenceClass: "direct",
      requiredState: ["actor", "terminal"],
      visibleState: ["actor", "terminal"],
      evidence: "all required state is visible",
    },
    observation: {
      evidenceClass: "direct",
      coherent: true,
      evidence: "settled reads agree",
      samples: [
        { stateSignature: "ready", settled: true },
        { stateSignature: "ready", settled: true },
      ],
    },
    outcome: {
      evidenceClass: "direct",
      observable: true,
      success: { id: "success", description: "success", condition: "hud === 1", observedFields: ["hud"] },
      failure: { id: "failure", description: "failure", condition: "hud === 0", observedFields: ["hud"] },
      ambiguity: { id: "ambiguity", description: "ambiguity", condition: "hud unreadable", observedFields: ["hud"] },
    },
  };
  const blockedInput = structuredClone(passingInput);
  blockedInput.control.responseObserved = false;
  const blockedPreflight = evaluateObservationPreflight(blockedInput);
  const diagnosticPayload = {
    schemaVersion: 1,
    recordKind: "environment-recovery",
    targetBinding,
    observedAt: "2026-08-27T08:00:00+01:00",
    executionBoundary: "CLI self-test",
    claimClass: "direct",
    preflight: blockedPreflight,
    blockers: blockedPreflight.blockers,
    failureBoundary: "control boundary",
    nextRecovery: "retry once",
    budget: { subgoalAttemptsUsed: 1, sessionAttemptsUsed: 1 },
    cleanup: { heldInputsReleased: true, temporarySessionsClosed: true },
    persistence: { atomicWrite: "temp-file-rename", redacted: true },
  };
  const validDiagnostic = {
    ...diagnosticPayload,
    checksum: {
      algorithm: "sha256",
      canonicalization: "json-sorted-keys-v1",
      digest: sha256Canonical(diagnosticPayload),
    },
  };
  fs.writeFileSync(invalidJsonPath, "{invalid", "utf8");
  fs.writeFileSync(incompletePath, JSON.stringify({ schemaVersion: 1, targetBinding: {} }), "utf8");
  fs.writeFileSync(passingPath, JSON.stringify(passingInput), "utf8");
  fs.writeFileSync(diagnosticPath, JSON.stringify(validDiagnostic), "utf8");
  const runCli = (cliArgs) => spawnSync(process.execPath, [observationCli, ...cliArgs], { encoding: "utf8" });
  const invalidJson = runCli(["--input", invalidJsonPath]);
  const incomplete = runCli(["--input", incompletePath]);
  const passing = runCli(["--input", passingPath]);
  const diagnostic = runCli(["--diagnostic", diagnosticPath]);
  const usage = runCli([]);
  const mixedModes = runCli(["--self-test", "--input", invalidJsonPath]);
  const unknownMode = runCli(["--unknown"]);
  const missing = runCli(["--input", missingPath]);
  let invalidJsonResult = null;
  let incompleteResult = null;
  let passingResult = null;
  let diagnosticResult = null;
  let missingResult = null;
  try { invalidJsonResult = JSON.parse(invalidJson.stdout); } catch {}
  try { incompleteResult = JSON.parse(incomplete.stdout); } catch {}
  try { passingResult = JSON.parse(passing.stdout); } catch {}
  try { diagnosticResult = JSON.parse(diagnostic.stdout); } catch {}
  try { missingResult = JSON.parse(missing.stdout); } catch {}
  tests.cli_invalid_json_is_structured =
    invalidJson.status === 2 &&
    invalidJsonResult?.passed === false &&
    invalidJsonResult?.blockers?.includes("input is not valid JSON");
  tests.cli_incomplete_record_is_structured =
    incomplete.status === 2 &&
    incompleteResult?.passed === false &&
    incompleteResult?.blockers?.includes("actionRequirements must be an object");
  tests.cli_passing_preflight_exit_zero = passing.status === 0 && passingResult?.passed === true;
  tests.cli_valid_diagnostic_exit_zero = diagnostic.status === 0 && diagnosticResult?.passed === true;
  tests.cli_usage_exit_one = usage.status === 1 && /Usage:/.test(usage.stderr);
  tests.cli_modes_are_mutually_exclusive = mixedModes.status === 1 && /Usage:/.test(mixedModes.stderr);
  tests.cli_unknown_mode_exit_one = unknownMode.status === 1 && /Usage:/.test(unknownMode.stderr);
  tests.cli_missing_file_is_structured =
    missing.status === 2 &&
    missingResult?.passed === false &&
    missingResult?.blockers?.includes("input file could not be read");
} catch {
  tests.cli_invalid_json_is_structured = false;
  tests.cli_incomplete_record_is_structured = false;
  tests.cli_passing_preflight_exit_zero = false;
  tests.cli_valid_diagnostic_exit_zero = false;
  tests.cli_usage_exit_one = false;
  tests.cli_modes_are_mutually_exclusive = false;
  tests.cli_unknown_mode_exit_one = false;
  tests.cli_missing_file_is_structured = false;
} finally {
  fs.rmSync(cliTestRoot, { recursive: true, force: true });
}

const explicitReference = referenceIndex >= 0
  ? path.resolve(args[referenceIndex + 1])
  : null;
const referenceModules = [
  path.join("app", "game", "autopilot.mjs"),
  path.join("app", "game", "level-data.mjs"),
  path.join("app", "game", "lessons.mjs"),
];
const missingReferenceModules = explicitReference
  ? referenceModules.filter((relativePath) => !fs.existsSync(path.join(explicitReference, relativePath)))
  : [];
const referenceRoot = explicitReference && missingReferenceModules.length === 0
  ? explicitReference
  : null;

let reference = "absent (portable document-only pass)";
if (referenceRoot) {
  tests.explicit_reference_valid = true;
  try {
    const solver = await import(
      pathToFileURL(path.join(referenceRoot, "app", "game", "autopilot.mjs")).href
    );
    const level = await import(
      pathToFileURL(path.join(referenceRoot, "app", "game", "level-data.mjs")).href
    );
    const lessons = await import(
      pathToFileURL(path.join(referenceRoot, "app", "game", "lessons.mjs")).href
    );
    const solved = solver.solveRoom(0);
    tests.reference_cold_solve = Boolean(solved && solved.trace.length);
    tests.reference_trace_verifies = solved
      ? solver.verifyTrace(0, solved.trace) === true
      : false;
    tests.reference_lessons_complete =
      Object.keys(lessons.LESSONS.rooms).length === level.TOTAL_ROOMS;
    reference = referenceRoot;
  } catch (error) {
    tests.explicit_reference_valid = false;
    tests.reference_cold_solve = false;
    reference = `error: ${String(error.message).slice(0, 120)}`;
  }
} else if (explicitReference) {
  tests.explicit_reference_valid = false;
  reference = `invalid: ${explicitReference}; missing: ${missingReferenceModules.join(", ")}`;
}

const passed = Object.values(tests).every(Boolean);
process.stdout.write(
  `${JSON.stringify({ passed, version: VERSION, reference, tests }, null, 2)}\n`,
);
process.exit(passed ? 0 : 1);
