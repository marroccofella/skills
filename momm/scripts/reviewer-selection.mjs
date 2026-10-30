// Registry exclusions cannot reduce caller quorum or manufacture votes from duplicate profiles.
import fs from 'node:fs';
import path from 'node:path';
import {ReviewerRegistry,defaultRegistryHome} from './reviewer-registry.mjs';
export function applyReviewerSettings(options,{root=defaultRegistryHome(),project=process.cwd()}={}){
  if(options.preflight||options.doctor||options.capabilitiesMatrix)return {applied:false,excluded:[],reason:'read-only inventory, not dispatch'};
  const exists=fs.existsSync(path.join(root,'registry.json'));
  const state=exists?new ReviewerRegistry({root,project}).read():null;
  const excluded=state?.baseline_excluded||[];
  const requested=options.reviewers||[],available=[...new Set(requested.filter(route=>!excluded.includes(route)))];
  const removed=[...new Set(requested.filter(route=>excluded.includes(route)))];
  if(options.reviewersExplicit&&requested.some(route=>excluded.includes(route)))throw Error('A requested reviewer is excluded in saved settings. Restore it explicitly before dispatch.');
  const required=options.minSuccess??1;
  // Normalization never invents a new gate merely because settings exist.
  // The existing dispatcher retains its self_excluded row and structured
  // quorum_failed result. Refuse here only when saved removals reduced it.
  if(removed.length&&available.filter(route=>route!==options.governor).length<required)throw Error('Reviewer selection leaves insufficient external quorum. Restore distinct reviewers; the quorum was not lowered.');
  options.reviewers=available;
  return {applied:exists,excluded:[...excluded],removed_from_selection:removed,...(state?{registry_revision:state.revision}:{})};
}
