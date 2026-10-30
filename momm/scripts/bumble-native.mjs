// Native entry gate: called only after the original independent report is persisted.
// No prompt, worker response or caller flag can activate credential policy.
import {REMOTE_POLICY_ACTIVE} from './reviewer-registry.mjs';
import {BUMBLE_PEER_DEFAULT_ENABLED, BUMBLE_PEER_SCHEMA} from './bumble-peer-review.mjs';
// The trusted host may prepare the separate synthetic shadow qualification seam.
// Exporting it is not default activation or a protected approval broker.
export {runBumblePeerShadow} from './bumble-peer-shadow.mjs';
// Explicit owner-host pilot composition, separate from default activation.
// It requires a pinned signed one-use plan and original sealed baseline.
export {createBumbleOAuthPilot} from './bumble-oauth-pilot.mjs';
export function nativeBumbleReadiness(){
  return {schema:'momm-bumble-native-readiness/1',policy_active:REMOTE_POLICY_ACTIVE,
    credentials_read:false,dispatched:0,qualified_workers:0,quorum_votes:0,
    baseline_order:'independent whole-piece reports sealed first',
    physical_capacity:'global owner-private reservation component; native binding pending',
    peer_contract:BUMBLE_PEER_SCHEMA,shadow_enabled:BUMBLE_PEER_DEFAULT_ENABLED,
    oauth_pilot:'signed_one_use_host_composition_available; host qualification required',
    shadow_status:'requires_qualified_host_and_operator_reconciliation',status:'policy_required',completion:false};
}
export async function runNativeBumbleStage(options){
  // Deliberately before dereferencing any caller-supplied credentials or hooks.
  if(!REMOTE_POLICY_ACTIVE)return {...nativeBumbleReadiness(),reason:'Native owner-approval broker and adapter qualification are not active. The development authentication direction does not activate a connector. No credentialed preflight or inference occurred.'};
  // An accepted future policy does not silently turn incomplete components live.
  // Cross-run reservation binding, release/status verification, protected owner
  // receipts, platform stores and the supervised HTTP worker must be qualified.
  void options;
  return {...nativeBumbleReadiness(),status:'adapter_not_qualified',reason:'Native transport and resource-release qualification are incomplete; no worker dispatched.'};
}
