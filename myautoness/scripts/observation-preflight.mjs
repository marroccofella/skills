#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PREFLIGHT_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
const DIRECT = "direct";
const HASH_ALGORITHM = "sha256";
const CANONICALIZATION = "json-sorted-keys-v1";
const MAX_CANONICAL_DEPTH = 100;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalized(value) {
  return nonEmpty(value) ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isIsoInstantWithTimezone(value) {
  if (!nonEmpty(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

function canonicalBlockers(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !nonEmpty(item))) return null;
  return value.map(normalized).sort();
}

function recordOrBlock(value, label, blockers) {
  if (!isRecord(value)) {
    blockers.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function canonicalJsonValue(value, active, depth) {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`canonical JSON exceeds maximum depth ${MAX_CANONICAL_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`canonical JSON does not support ${typeof value}`);
  if (active.has(value)) throw new TypeError("canonical JSON cannot contain cyclic references");

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError("canonical JSON arrays cannot have symbol properties");
      const ownNames = Object.getOwnPropertyNames(value);
      const unsupportedName = ownNames.find((key) =>
        key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      );
      if (unsupportedName !== undefined) throw new TypeError(`canonical JSON array has unsupported property ${unsupportedName}`);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("canonical JSON arrays cannot be sparse");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`canonical JSON array index ${index} must be an enumerable data property`);
      }
      return `[${value.map((item) => canonicalJsonValue(item, active, depth + 1)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("canonical JSON objects must be plain objects");
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError("canonical JSON objects cannot have symbol properties");
    const keys = Object.getOwnPropertyNames(value);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`canonical JSON property ${key} must be an enumerable data property`);
    }
    return `{${keys.sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonValue(value[key], active, depth + 1)}`
    ).join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalJsonValue(value, new Set(), 0);
}

export function sha256Canonical(value) {
  return crypto.createHash(HASH_ALGORITHM).update(canonicalJson(value)).digest("hex");
}

function canonicalOrBlock(value, label, blockers) {
  try {
    return canonicalJson(value);
  } catch (error) {
    blockers.push(`${label} is not canonical JSON: ${String(error.message)}`);
    return null;
  }
}

function targetBindingDigest(value, blockers) {
  try {
    return sha256Canonical(value);
  } catch (error) {
    blockers.push(`target binding cannot be canonically hashed: ${String(error.message)}`);
    return null;
  }
}

function preflightResult(blockers, bindingDigest = null) {
  const passed = blockers.length === 0;
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    passed,
    episodeAllowed: passed,
    gameplayEpisodesRecorded: 0,
    recordAs: passed ? "preflight-passed" : "environment-recovery",
    targetBindingDigest: bindingDigest,
    blockers,
  };
}

function diagnosticResult(blockers) {
  return { schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, passed: blockers.length === 0, blockers };
}

function validateContentIdentity(value, blockers, prefix = "target") {
  if (!isRecord(value)) {
    blockers.push(`${prefix} content identity is missing`);
    return;
  }
  if (value.algorithm !== HASH_ALGORITHM) blockers.push(`${prefix} content identity algorithm must be sha256`);
  if (value.canonicalization !== CANONICALIZATION) blockers.push(`${prefix} content identity canonicalization is unsupported`);
  if (!isRecord(value.sourceFields) || Object.keys(value.sourceFields).length === 0) {
    blockers.push(`${prefix} content identity source fields are missing`);
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(value.digest ?? "")) {
    blockers.push(`${prefix} content identity digest is malformed`);
    return;
  }
  try {
    if (value.digest !== sha256Canonical(value.sourceFields)) blockers.push(`${prefix} content identity digest does not match source fields`);
  } catch (error) {
    blockers.push(`${prefix} content identity source fields are not canonical JSON: ${String(error.message)}`);
  }
}

function validateTargetBinding(value, blockers) {
  if (!isRecord(value)) {
    blockers.push("target binding is missing");
    return;
  }
  if (value.evidenceClass !== DIRECT) blockers.push("target binding is not direct");
  if (!nonEmpty(value.identity)) blockers.push("target identity is missing");
  validateContentIdentity(value.contentIdentity, blockers);
}

function validatePredicate(value, label, blockers) {
  if (!isRecord(value)) {
    blockers.push(`${label} predicate is undefined`);
    return null;
  }
  if (!nonEmpty(value.id)) blockers.push(`${label} predicate id is missing`);
  if (!nonEmpty(value.description)) blockers.push(`${label} predicate description is missing`);
  if (!nonEmpty(value.condition)) blockers.push(`${label} predicate condition is missing`);
  if (!Array.isArray(value.observedFields) || !value.observedFields.some(nonEmpty)) blockers.push(`${label} predicate observed fields are missing`);
  else if (value.observedFields.some((field) => !nonEmpty(field))) blockers.push(`${label} predicate observed fields must contain only non-empty strings`);
  return {
    id: normalized(value.id),
    condition: normalized(value.condition),
  };
}

export function evaluateObservationPreflight(input) {
  if (!isRecord(input)) return preflightResult(["preflight must be an object"]);
  const root = input;
  if (root.schemaVersion !== PREFLIGHT_SCHEMA_VERSION) {
    return preflightResult([`unsupported schemaVersion ${String(root.schemaVersion)}; expected ${PREFLIGHT_SCHEMA_VERSION}`]);
  }

  const blockers = [];
  validateTargetBinding(root.targetBinding, blockers);
  const bindingDigest = isRecord(root.targetBinding) ? targetBindingDigest(root.targetBinding, blockers) : null;
  const actionRequirements = recordOrBlock(root.actionRequirements, "actionRequirements", blockers);
  const control = recordOrBlock(root.control, "control", blockers);
  const visibility = recordOrBlock(root.visibility, "visibility", blockers);
  const observation = recordOrBlock(root.observation, "observation", blockers);
  const outcome = recordOrBlock(root.outcome, "outcome", blockers);

  if (typeof actionRequirements.requiresHold !== "boolean") blockers.push("action hold requirement is undefined");

  if (control.evidenceClass !== DIRECT) blockers.push("control evidence is not direct");
  if (control.responseObserved !== true) blockers.push("no causal control response observed");
  if (!nonEmpty(control.actionId)) blockers.push("control action id is missing");
  if (!nonEmpty(control.action)) blockers.push("control action is missing");
  if (!isRecord(control.beforeState)) blockers.push("control before-state is missing");
  if (!isRecord(control.afterState)) blockers.push("control after-state is missing");
  if (!Array.isArray(control.changedFields) || control.changedFields.some((field) => !nonEmpty(field))) blockers.push("control changed fields must contain only non-empty strings");
  const changedFields = Array.isArray(control.changedFields) ? control.changedFields.filter(nonEmpty) : [];
  if (changedFields.length === 0) blockers.push("control state change is not identified");
  if (isRecord(control.beforeState) && isRecord(control.afterState)) {
    const beforeState = canonicalOrBlock(control.beforeState, "control before-state", blockers);
    const afterState = canonicalOrBlock(control.afterState, "control after-state", blockers);
    if (beforeState !== null && afterState !== null && beforeState === afterState) blockers.push("control before-state and after-state are identical");
    const ambiguousFields = [];
    const unconfirmed = changedFields.filter((field) => {
      const fieldIdentity = normalized(field);
      const beforeKeys = Object.keys(control.beforeState).filter((key) => normalized(key) === fieldIdentity);
      const afterKeys = Object.keys(control.afterState).filter((key) => normalized(key) === fieldIdentity);
      if (beforeKeys.length > 1 || afterKeys.length > 1) {
        ambiguousFields.push(field.trim());
        return false;
      }
      if (beforeKeys.length !== afterKeys.length) return false;
      if (beforeKeys.length === 0) return true;
      const beforeField = canonicalOrBlock(control.beforeState[beforeKeys[0]], `control before-state field ${field.trim()}`, blockers);
      const afterField = canonicalOrBlock(control.afterState[afterKeys[0]], `control after-state field ${field.trim()}`, blockers);
      return beforeField !== null && afterField !== null && beforeField === afterField;
    });
    if (ambiguousFields.length) blockers.push(`control state fields are ambiguous after normalization: ${ambiguousFields.join(", ")}`);
    if (unconfirmed.length) blockers.push(`declared control fields did not change: ${unconfirmed.join(", ")}`);
  }
  if (!nonEmpty(control.evidence)) blockers.push("control evidence is missing");

  if (!Array.isArray(visibility.requiredState) || visibility.requiredState.some((item) => !nonEmpty(item))) blockers.push("required state identifiers must contain only non-empty strings");
  if (!Array.isArray(visibility.visibleState) || visibility.visibleState.some((item) => !nonEmpty(item))) blockers.push("visible state identifiers must contain only non-empty strings");
  const requiredState = Array.isArray(visibility.requiredState) ? visibility.requiredState.filter(nonEmpty) : [];
  const visibleState = new Set(Array.isArray(visibility.visibleState) ? visibility.visibleState.filter(nonEmpty).map(normalized) : []);
  if (visibility.evidenceClass !== DIRECT) blockers.push("visibility evidence is not direct");
  if (requiredState.length === 0) blockers.push("required visible state is undefined");
  if (!nonEmpty(visibility.evidence)) blockers.push("visibility evidence is missing");
  const missingState = requiredState.filter((item) => !visibleState.has(normalized(item)));
  if (missingState.length) blockers.push(`state not visible: ${missingState.join(", ")}`);

  if (observation.evidenceClass !== DIRECT) blockers.push("observation evidence is not direct");
  if (observation.coherent !== true) blockers.push("observation is ambiguous or incoherent");
  if (!nonEmpty(observation.evidence)) blockers.push("observation evidence is missing");
  const samples = Array.isArray(observation.samples) ? observation.samples : [];
  if (samples.length < 2 || samples.some((sample) => !isRecord(sample) || sample.settled !== true || !nonEmpty(sample.stateSignature))) {
    blockers.push("at least two settled observation samples are required");
  } else if (new Set(samples.map((sample) => normalized(sample.stateSignature))).size !== 1) {
    blockers.push("settled observation samples do not agree");
  }

  if (outcome.evidenceClass !== DIRECT) blockers.push("outcome evidence is not direct");
  const predicates = [
    validatePredicate(outcome.success, "success", blockers),
    validatePredicate(outcome.failure, "failure", blockers),
    validatePredicate(outcome.ambiguity, "ambiguity", blockers),
  ].filter(Boolean);
  if (predicates.length === 3) {
    if (new Set(predicates.map((predicate) => predicate.id)).size !== 3) blockers.push("success, failure and ambiguity predicate ids are not distinct");
    if (new Set(predicates.map((predicate) => predicate.condition)).size !== 3) blockers.push("success, failure and ambiguity predicate conditions are not distinct");
  }
  if (outcome.observable !== true) blockers.push("outcome predicate is not observable");

  const heldInput = root.heldInput;
  if (actionRequirements.requiresHold === true && heldInput === undefined) blockers.push("required held input declaration is missing");
  if (actionRequirements.requiresHold === true && heldInput !== undefined) {
    const held = recordOrBlock(heldInput, "heldInput", blockers);
    if (held.evidenceClass !== DIRECT) blockers.push("held input evidence is not direct");
    if (held.supported !== true) blockers.push("required held input is unsupported");
    if (!nonEmpty(held.actionId)) blockers.push("held input action id is missing");
    if (nonEmpty(held.actionId) && nonEmpty(control.actionId) && normalized(held.actionId) !== normalized(control.actionId)) blockers.push("held input action id does not match control action id");
    if (!nonEmpty(held.action)) blockers.push("held input action is missing");
    if (!positiveNumber(held.requestedDurationMs)) blockers.push("held input requested duration is invalid");
    if (!positiveNumber(held.observedDurationMs)) blockers.push("held input observed duration is invalid");
    if (positiveNumber(held.requestedDurationMs) && positiveNumber(held.observedDurationMs) && held.observedDurationMs < held.requestedDurationMs) blockers.push("held input observed duration is shorter than requested duration");
    if (!nonEmpty(held.capabilityEvidence)) blockers.push("held input capability evidence is missing");
    if (held.releaseGuaranteed !== true) blockers.push("held input release is not guaranteed");
    if (held.releaseObserved !== true) blockers.push("held input release was not directly observed");
    if (!nonEmpty(held.releaseEvidence)) blockers.push("held input release evidence is missing");
  } else if (actionRequirements.requiresHold === false && heldInput !== undefined) {
    blockers.push("held input declaration is unexpected when no hold is required");
  }

  return preflightResult(blockers, bindingDigest);
}

export function evaluateEnvironmentRecoveryDiagnostic(input) {
  if (!isRecord(input)) return diagnosticResult(["diagnostic must be an object"]);
  const root = input;
  if (root.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION) {
    return diagnosticResult([`unsupported diagnostic schemaVersion ${String(root.schemaVersion)}; expected ${DIAGNOSTIC_SCHEMA_VERSION}`]);
  }
  const blockers = [];
  if (root.recordKind !== "environment-recovery") blockers.push("record kind is invalid");
  validateTargetBinding(root.targetBinding, blockers);
  const bindingDigest = isRecord(root.targetBinding) ? targetBindingDigest(root.targetBinding, blockers) : null;
  if (!isIsoInstantWithTimezone(root.observedAt)) blockers.push("observedAt is not a valid ISO-8601 instant with timezone");
  if (!nonEmpty(root.executionBoundary)) blockers.push("execution boundary is missing");
  if (!["direct", "reported", "not-established"].includes(root.claimClass)) blockers.push("claim class is invalid");
  if (!isRecord(root.preflight) || root.preflight.schemaVersion !== PREFLIGHT_SCHEMA_VERSION) {
    blockers.push("preflight result is missing or uses an unknown schema");
  } else {
    if (root.preflight.passed !== false || root.preflight.episodeAllowed !== false) blockers.push("diagnostic preflight must be blocked");
    if (root.preflight.recordAs !== "environment-recovery") blockers.push("diagnostic preflight record class is invalid");
    if (root.preflight.gameplayEpisodesRecorded !== 0) blockers.push("diagnostic must record zero gameplay episodes");
    if (!/^[a-f0-9]{64}$/.test(root.preflight.targetBindingDigest ?? "")) blockers.push("preflight target binding digest is missing or invalid");
    else if (bindingDigest && root.preflight.targetBindingDigest !== bindingDigest) blockers.push("diagnostic target binding does not match preflight target binding");
  }
  const diagnosticBlockers = canonicalBlockers(root.blockers);
  if (!diagnosticBlockers) blockers.push("diagnostic blockers are missing or invalid");
  const preflightBlockers = isRecord(root.preflight) ? canonicalBlockers(root.preflight.blockers) : null;
  if (isRecord(root.preflight) && !preflightBlockers) blockers.push("preflight blockers are missing or invalid");
  if (diagnosticBlockers && preflightBlockers && canonicalJson(diagnosticBlockers) !== canonicalJson(preflightBlockers)) blockers.push("diagnostic blockers do not match preflight blockers");
  if (!nonEmpty(root.failureBoundary)) blockers.push("failure boundary is missing");
  if (!nonEmpty(root.nextRecovery)) blockers.push("bounded next recovery is missing");
  const budget = isRecord(root.budget) ? root.budget : {};
  if (!nonNegativeInteger(budget.subgoalAttemptsUsed) || budget.subgoalAttemptsUsed > 10) blockers.push("subgoal recovery budget is invalid");
  if (!nonNegativeInteger(budget.sessionAttemptsUsed) || budget.sessionAttemptsUsed > 30) blockers.push("session recovery budget is invalid");
  if (nonNegativeInteger(budget.subgoalAttemptsUsed) && nonNegativeInteger(budget.sessionAttemptsUsed) && budget.sessionAttemptsUsed < budget.subgoalAttemptsUsed) blockers.push("session recovery attempts cannot be lower than subgoal recovery attempts");
  const cleanup = isRecord(root.cleanup) ? root.cleanup : {};
  if (cleanup.heldInputsReleased !== true || cleanup.temporarySessionsClosed !== true) blockers.push("diagnostic cleanup is incomplete");
  const persistence = isRecord(root.persistence) ? root.persistence : {};
  if (persistence.atomicWrite !== "temp-file-rename") blockers.push("diagnostic write is not atomic");
  if (persistence.redacted !== true) blockers.push("diagnostic is not marked redacted");
  const checksum = isRecord(root.checksum) ? root.checksum : {};
  if (checksum.algorithm !== HASH_ALGORITHM || checksum.canonicalization !== CANONICALIZATION) {
    blockers.push("diagnostic checksum metadata is invalid");
  } else if (!/^[a-f0-9]{64}$/.test(checksum.digest ?? "")) {
    blockers.push("diagnostic checksum digest is malformed");
  } else {
    const { checksum: _checksum, ...payload } = root;
    try {
      if (checksum.digest !== sha256Canonical(payload)) blockers.push("diagnostic checksum does not match payload");
    } catch (error) {
      blockers.push(`diagnostic payload is not canonical JSON: ${String(error.message)}`);
    }
  }
  return diagnosticResult(blockers);
}

function targetBindingFixture() {
  const sourceFields = {
    targetUrl: "https://example.test/game",
    application: "example controlled game",
    observerVersion: "1.0.0",
    viewport: "1280x720@1",
  };
  return {
    evidenceClass: DIRECT,
    identity: "example controlled game at /game",
    contentIdentity: {
      algorithm: HASH_ALGORITHM,
      canonicalization: CANONICALIZATION,
      sourceFields,
      digest: sha256Canonical(sourceFields),
    },
  };
}

function predicate(id, description, condition) {
  return { id, description, condition, observedFields: ["hud"] };
}

function passingFixture() {
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    targetBinding: targetBindingFixture(),
    actionRequirements: { requiresHold: true },
    control: {
      evidenceClass: DIRECT,
      responseObserved: true,
      actionId: "launch-space",
      action: "hold launch",
      beforeState: { hud: "waiting", ball: "rest" },
      afterState: { hud: "launched", ball: "moving" },
      changedFields: ["hud", "ball"],
      evidence: "benign action changed the target state",
    },
    visibility: {
      evidenceClass: DIRECT,
      requiredState: ["actor", "hazard", "terminal"],
      visibleState: ["actor", "hazard", "terminal"],
      evidence: "viewport and semantic state include every required item",
    },
    observation: {
      evidenceClass: DIRECT,
      coherent: true,
      evidence: "two settled reads agree",
      samples: [
        { stateSignature: "settled-a", settled: true },
        { stateSignature: "settled-a", settled: true },
      ],
    },
    outcome: {
      evidenceClass: DIRECT,
      success: predicate("success", "terminal counter reaches one", "hud.terminal === 1"),
      failure: predicate("failure", "released action leaves counter at zero", "hud.terminal === 0"),
      ambiguity: predicate("ambiguity", "counter cannot be read", "hud.terminal is unreadable"),
      observable: true,
    },
    heldInput: {
      evidenceClass: DIRECT,
      supported: true,
      actionId: "launch-space",
      action: "Space keydown then keyup",
      requestedDurationMs: 500,
      observedDurationMs: 503,
      capabilityEvidence: "trusted event timestamps show a held interval",
      releaseGuaranteed: true,
      releaseObserved: true,
      releaseEvidence: "keyup and finally cleanup were directly observed",
    },
  };
}

function diagnosticFixture() {
  const fixture = passingFixture();
  fixture.control.responseObserved = false;
  const preflight = evaluateObservationPreflight(fixture);
  const payload = {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    recordKind: "environment-recovery",
    targetBinding: targetBindingFixture(),
    observedAt: "2026-08-26T22:09:00+01:00",
    executionBoundary: "browser / shell / iframe / canvas",
    claimClass: DIRECT,
    preflight,
    blockers: preflight.blockers,
    failureBoundary: "shell-to-iframe input boundary; exact cause unknown",
    nextRecovery: "open the standalone route and rerun preflight once",
    budget: { subgoalAttemptsUsed: 1, sessionAttemptsUsed: 1 },
    cleanup: { heldInputsReleased: true, temporarySessionsClosed: true },
    persistence: { atomicWrite: "temp-file-rename", redacted: true },
  };
  return {
    ...payload,
    checksum: {
      algorithm: HASH_ALGORITHM,
      canonicalization: CANONICALIZATION,
      digest: sha256Canonical(payload),
    },
  };
}

function refreshDiagnosticChecksum(diagnostic) {
  const { checksum: _checksum, ...payload } = diagnostic;
  diagnostic.checksum.digest = sha256Canonical(payload);
  return diagnostic;
}

export function runSelfTest() {
  const good = evaluateObservationPreflight(passingFixture());
  const incomplete = evaluateObservationPreflight({ schemaVersion: PREFLIGHT_SCHEMA_VERSION, targetBinding: {} });
  const unknownSchema = evaluateObservationPreflight({ schemaVersion: 999 });
  const hidden = passingFixture();
  hidden.visibility.visibleState = ["actor", "terminal"];
  const hiddenResult = evaluateObservationPreflight(hidden);
  const reported = passingFixture();
  reported.control.evidenceClass = "reported";
  const reportedResult = evaluateObservationPreflight(reported);
  const unsupportedHold = passingFixture();
  unsupportedHold.heldInput.supported = false;
  const holdResult = evaluateObservationPreflight(unsupportedHold);
  const ambiguous = passingFixture();
  ambiguous.observation.coherent = false;
  const ambiguousResult = evaluateObservationPreflight(ambiguous);
  const weak = passingFixture();
  weak.control.beforeState = {};
  weak.control.afterState = {};
  weak.control.changedFields = [];
  weak.visibility.evidence = "";
  weak.observation.samples = [];
  weak.outcome.failure = {};
  const weakResult = evaluateObservationPreflight(weak);
  const missingHold = passingFixture();
  delete missingHold.heldInput;
  const missingHoldResult = evaluateObservationPreflight(missingHold);
  const contradictory = passingFixture();
  contradictory.control.afterState = { ...contradictory.control.beforeState };
  contradictory.outcome.failure = { ...contradictory.outcome.success };
  const contradictoryResult = evaluateObservationPreflight(contradictory);
  const duplicateCondition = passingFixture();
  duplicateCondition.outcome.failure.condition = `  ${duplicateCondition.outcome.success.condition.toUpperCase()}  `;
  const duplicateConditionResult = evaluateObservationPreflight(duplicateCondition);
  const staleBinding = passingFixture();
  staleBinding.targetBinding.contentIdentity.digest = "0".repeat(64);
  const staleBindingResult = evaluateObservationPreflight(staleBinding);
  const unauditedHold = passingFixture();
  unauditedHold.heldInput.evidenceClass = "reported";
  unauditedHold.heldInput.releaseEvidence = "";
  const unauditedHoldResult = evaluateObservationPreflight(unauditedHold);
  const wrongHeldAction = passingFixture();
  wrongHeldAction.heldInput.actionId = "left-flipper";
  const wrongHeldActionResult = evaluateObservationPreflight(wrongHeldAction);
  const shortHeldInput = passingFixture();
  shortHeldInput.heldInput.observedDurationMs = 499;
  const shortHeldInputResult = evaluateObservationPreflight(shortHeldInput);
  const unexpectedHeldInput = passingFixture();
  unexpectedHeldInput.actionRequirements.requiresHold = false;
  const unexpectedHeldInputResult = evaluateObservationPreflight(unexpectedHeldInput);
  const normalizedVisibility = passingFixture();
  normalizedVisibility.visibility.visibleState = [" ACTOR ", "HAZARD", "terminal"];
  const normalizedVisibilityResult = evaluateObservationPreflight(normalizedVisibility);
  const malformedVisibility = passingFixture();
  malformedVisibility.visibility.requiredState = ["actor", 42];
  const malformedVisibilityResult = evaluateObservationPreflight(malformedVisibility);
  const appearingField = passingFixture();
  appearingField.control.beforeState = { hud: "waiting" };
  appearingField.control.afterState = { hud: "waiting", gameOver: true };
  appearingField.control.changedFields = [" GAMEOVER "];
  const appearingFieldResult = evaluateObservationPreflight(appearingField);
  let undefinedCanonicalRejected = false;
  let nonFiniteCanonicalRejected = false;
  let cyclicCanonicalRejected = false;
  let accessorArrayRejected = false;
  try { canonicalJson({ value: undefined }); } catch (error) { undefinedCanonicalRejected = error instanceof TypeError; }
  try { canonicalJson({ value: Number.NaN }); } catch (error) { nonFiniteCanonicalRejected = error instanceof TypeError; }
  try {
    const cyclic = {};
    cyclic.self = cyclic;
    canonicalJson(cyclic);
  } catch (error) {
    cyclicCanonicalRejected = error instanceof TypeError && /cyclic/i.test(error.message);
  }
  try {
    const accessorArray = [];
    Object.defineProperty(accessorArray, "0", { enumerable: true, configurable: true, get: () => 7 });
    accessorArray.length = 1;
    canonicalJson(accessorArray);
  } catch (error) {
    accessorArrayRejected = error instanceof TypeError && /data property|accessor/i.test(error.message);
  }
  const diagnostic = diagnosticFixture();
  const validDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(diagnostic);
  const badDiagnostic = diagnosticFixture();
  badDiagnostic.budget.sessionAttemptsUsed = 31;
  badDiagnostic.persistence.atomicWrite = "direct-write";
  refreshDiagnosticChecksum(badDiagnostic);
  const badDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(badDiagnostic);
  const staleDiagnostic = diagnosticFixture();
  staleDiagnostic.nextRecovery = "changed after checksum";
  const staleDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(staleDiagnostic);
  const impossibleDateDiagnostic = diagnosticFixture();
  impossibleDateDiagnostic.observedAt = "2026-99-99T99:99:99+99:99";
  refreshDiagnosticChecksum(impossibleDateDiagnostic);
  const impossibleDateDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(impossibleDateDiagnostic);
  const mismatchedBlockersDiagnostic = diagnosticFixture();
  mismatchedBlockersDiagnostic.blockers = ["different blocker"];
  refreshDiagnosticChecksum(mismatchedBlockersDiagnostic);
  const mismatchedBlockersDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(mismatchedBlockersDiagnostic);
  const impossibleBudgetDiagnostic = diagnosticFixture();
  impossibleBudgetDiagnostic.budget = { subgoalAttemptsUsed: 10, sessionAttemptsUsed: 0 };
  refreshDiagnosticChecksum(impossibleBudgetDiagnostic);
  const impossibleBudgetDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(impossibleBudgetDiagnostic);
  const mismatchedTargetDiagnostic = diagnosticFixture();
  const differentSourceFields = {
    ...mismatchedTargetDiagnostic.targetBinding.contentIdentity.sourceFields,
    targetUrl: "https://example.test/different-game",
  };
  mismatchedTargetDiagnostic.targetBinding = {
    ...mismatchedTargetDiagnostic.targetBinding,
    identity: "different controlled game at /different-game",
    contentIdentity: {
      ...mismatchedTargetDiagnostic.targetBinding.contentIdentity,
      sourceFields: differentSourceFields,
      digest: sha256Canonical(differentSourceFields),
    },
  };
  refreshDiagnosticChecksum(mismatchedTargetDiagnostic);
  const mismatchedTargetDiagnosticResult = evaluateEnvironmentRecoveryDiagnostic(mismatchedTargetDiagnostic);
  const diagnosticAt = (observedAt) => {
    const value = diagnosticFixture();
    value.observedAt = observedAt;
    refreshDiagnosticChecksum(value);
    return evaluateEnvironmentRecoveryDiagnostic(value);
  };
  const leapDayResult = diagnosticAt("2024-02-29T12:00:00Z");
  const nonLeapDayResult = diagnosticAt("2026-02-29T12:00:00Z");
  const maxOffsetResult = diagnosticAt("2026-08-27T08:00:00+14:00");
  const excessiveOffsetResult = diagnosticAt("2026-08-27T08:00:00+14:01");
  const hour24Result = diagnosticAt("2026-08-27T24:00:00Z");
  const leapSecondResult = diagnosticAt("2026-08-27T08:00:60Z");

  return {
    passing_fixture_allows_episode: good.passed && good.episodeAllowed && good.recordAs === "preflight-passed" && good.gameplayEpisodesRecorded === 0 && /^[a-f0-9]{64}$/.test(good.targetBindingDigest),
    incomplete_preflight_returns_structured_block: !incomplete.passed && incomplete.episodeAllowed === false && incomplete.blockers.includes("actionRequirements must be an object"),
    unknown_schema_returns_structured_block: !unknownSchema.passed && unknownSchema.blockers.includes("unsupported schemaVersion 999; expected 1"),
    hidden_state_blocks_episode: !hiddenResult.passed && hiddenResult.blockers.includes("state not visible: hazard"),
    reported_control_blocks_episode: !reportedResult.passed && reportedResult.blockers.includes("control evidence is not direct"),
    unsupported_hold_blocks_episode: !holdResult.passed && holdResult.blockers.includes("required held input is unsupported"),
    ambiguous_observation_blocks_episode: !ambiguousResult.passed && ambiguousResult.blockers.includes("observation is ambiguous or incoherent"),
    blocked_run_records_zero_gameplay_episodes: hiddenResult.gameplayEpisodesRecorded === 0 && hiddenResult.recordAs === "environment-recovery",
    weak_self_attestation_is_rejected: !weakResult.passed && weakResult.blockers.includes("control before-state and after-state are identical") && weakResult.blockers.includes("visibility evidence is missing") && weakResult.blockers.includes("at least two settled observation samples are required") && weakResult.blockers.includes("failure predicate id is missing"),
    required_hold_declaration_is_enforced: !missingHoldResult.passed && missingHoldResult.blockers.includes("required held input declaration is missing"),
    contradictory_evidence_is_rejected: !contradictoryResult.passed && contradictoryResult.blockers.includes("control before-state and after-state are identical") && contradictoryResult.blockers.includes("success, failure and ambiguity predicate ids are not distinct") && contradictoryResult.blockers.includes("success, failure and ambiguity predicate conditions are not distinct"),
    duplicate_outcome_conditions_are_rejected: !duplicateConditionResult.passed && duplicateConditionResult.blockers.includes("success, failure and ambiguity predicate conditions are not distinct"),
    stale_content_binding_is_rejected: !staleBindingResult.passed && staleBindingResult.blockers.includes("target content identity digest does not match source fields"),
    held_input_requires_direct_release_evidence: !unauditedHoldResult.passed && unauditedHoldResult.blockers.includes("held input evidence is not direct") && unauditedHoldResult.blockers.includes("held input release evidence is missing"),
    held_input_is_bound_to_control_action: !wrongHeldActionResult.passed && wrongHeldActionResult.blockers.includes("held input action id does not match control action id"),
    held_input_must_meet_requested_duration: !shortHeldInputResult.passed && shortHeldInputResult.blockers.includes("held input observed duration is shorter than requested duration"),
    unexpected_held_input_is_rejected: !unexpectedHeldInputResult.passed && unexpectedHeldInputResult.blockers.includes("held input declaration is unexpected when no hold is required"),
    visibility_identifiers_are_normalized: normalizedVisibilityResult.passed,
    malformed_visibility_identifiers_are_rejected: !malformedVisibilityResult.passed && malformedVisibilityResult.blockers.includes("required state identifiers must contain only non-empty strings"),
    changed_field_presence_is_a_state_change: appearingFieldResult.passed,
    canonical_json_rejects_unsupported_values: undefinedCanonicalRejected && nonFiniteCanonicalRejected && cyclicCanonicalRejected && accessorArrayRejected,
    valid_diagnostic_is_accepted: validDiagnosticResult.passed,
    invalid_budget_and_non_atomic_diagnostic_are_rejected: !badDiagnosticResult.passed && badDiagnosticResult.blockers.includes("session recovery budget is invalid") && badDiagnosticResult.blockers.includes("diagnostic write is not atomic"),
    stale_diagnostic_checksum_is_rejected: !staleDiagnosticResult.passed && staleDiagnosticResult.blockers.includes("diagnostic checksum does not match payload"),
    impossible_diagnostic_timestamp_is_rejected: !impossibleDateDiagnosticResult.passed && impossibleDateDiagnosticResult.blockers.includes("observedAt is not a valid ISO-8601 instant with timezone"),
    diagnostic_blockers_must_match_preflight: !mismatchedBlockersDiagnosticResult.passed && mismatchedBlockersDiagnosticResult.blockers.includes("diagnostic blockers do not match preflight blockers"),
    diagnostic_attempt_counts_must_be_consistent: !impossibleBudgetDiagnosticResult.passed && impossibleBudgetDiagnosticResult.blockers.includes("session recovery attempts cannot be lower than subgoal recovery attempts"),
    diagnostic_is_bound_to_preflight_target: !mismatchedTargetDiagnosticResult.passed && mismatchedTargetDiagnosticResult.blockers.includes("diagnostic target binding does not match preflight target binding"),
    timestamp_calendar_boundaries_are_enforced:
      leapDayResult.passed &&
      maxOffsetResult.passed &&
      !nonLeapDayResult.passed &&
      !excessiveOffsetResult.passed &&
      !hour24Result.passed &&
      !leapSecondResult.passed,
  };
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  const platformIdentity = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  try {
    return platformIdentity(fs.realpathSync(left)) === platformIdentity(fs.realpathSync(right));
  } catch {
    return platformIdentity(path.resolve(left)) === platformIdentity(path.resolve(right));
  }
}

if (sameFileIdentity(process.argv[1], fileURLToPath(import.meta.url))) {
  const cliArgs = process.argv.slice(2);
  const selfTestMode = cliArgs.length === 1 && cliArgs[0] === "--self-test";
  const inputMode = cliArgs.length === 2 && cliArgs[0] === "--input" && nonEmpty(cliArgs[1]);
  const diagnosticMode = cliArgs.length === 2 && cliArgs[0] === "--diagnostic" && nonEmpty(cliArgs[1]);
  if (!selfTestMode && !inputMode && !diagnosticMode) {
    process.stderr.write("Usage: node scripts/observation-preflight.mjs [--self-test | --input <json-file> | --diagnostic <json-file>]\n");
    process.exit(1);
  }
  if (selfTestMode) {
    const tests = runSelfTest();
    const passed = Object.values(tests).every(Boolean);
    process.stdout.write(`${JSON.stringify({ passed, tests }, null, 2)}\n`);
    process.exit(passed ? 0 : 1);
  }
  const inputPath = path.resolve(cliArgs[1]);
  const isDiagnostic = diagnosticMode;
  const emitBlockedInput = (message) => {
    const result = isDiagnostic ? diagnosticResult([message]) : preflightResult([message]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(2);
  };
  let source;
  try {
    source = fs.readFileSync(inputPath, "utf8");
  } catch {
    emitBlockedInput("input file could not be read");
  }
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    emitBlockedInput("input is not valid JSON");
  }
  let result;
  try {
    result = isDiagnostic ? evaluateEnvironmentRecoveryDiagnostic(input) : evaluateObservationPreflight(input);
  } catch (error) {
    emitBlockedInput(`input validation failed: ${String(error.message)}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.passed ? 0 : 2);
}
