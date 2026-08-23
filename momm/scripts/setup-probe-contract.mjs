import { createHash } from "node:crypto";

export const SETUP_PROBE_LABEL = "setup-center connectivity validation";
export const SETUP_PROBE_INPUT = "Synthetic MOMM connectivity validation only. No repository source, filenames, or user data are included. Return the required structured review report.";
export const SETUP_PROBE_CAPABILITY_ENV = "MOMM_SETUP_PROBE_CAPABILITY";
export const SETUP_PROBE_BINDING_ENV = "MOMM_SETUP_PROBE_BINDING";

export function setupProbeBinding(capability, { governor, reviewer, label = SETUP_PROBE_LABEL, input = SETUP_PROBE_INPUT }) {
  return createHash("sha256")
    .update([capability, governor, reviewer, label, input].join("\0"), "utf8")
    .digest("hex");
}
