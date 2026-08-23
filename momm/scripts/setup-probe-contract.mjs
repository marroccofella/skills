import { createHash } from "node:crypto";

export const SETUP_PROBE_LABEL = "setup-center connectivity validation";
export const SETUP_PROBE_INPUT = "Synthetic MOMM connectivity validation only. No repository source, filenames, or user data are included. Return the required structured review report.";
export const SETUP_PROBE_AUTH_REQUEST = "momm_setup_probe_authorize";
export const SETUP_PROBE_AUTH_RESPONSE = "momm_setup_probe_authorization";

export function setupProbeDescriptor({ governor, reviewer, label = SETUP_PROBE_LABEL, input = SETUP_PROBE_INPUT }) {
  return {
    governor,
    reviewer,
    label,
    input_sha256: createHash("sha256").update(input, "utf8").digest("hex"),
  };
}
