// Governor-authored investigations of rev_20260920222239_g11f. Synthetic evidence only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {privateTestFixture} from './private-test-fixture.mjs';
import {preparePrivateEvidence} from './evidence-permissions.mjs';
import {startAttempt,attemptRecord,persistAttempt} from './attempts.mjs';
import {auditAttempts} from './attempt-audit.mjs';
import {digest,inspectCompletion} from './governor.mjs';
import {git,stateDir,readLock} from './update.mjs';
import {recordCheck} from './checks.mjs';
if (process.platform !== 'win32') process.umask(0o077); // fixture files must be owner-only: the evidence gate inspects their modes on POSIX
const root=privateTestFixture('momm-review-claims-');
const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
try {
  preparePrivateEvidence(path.join(root,'.ensemble_reviews'));
  write('source.mjs','export const x=1;\n');write('probe.mjs','console.log("synthetic check");\n');
  const input=digest('synthetic input');
  const make=(id,route,partial=false,amend=null)=>{
    const rows=['piece-01','piece-02'].map((piece,i)=>{
      const metadata={run_id:id,route,piece,input_sha256:input,piece_sha256:digest(piece),ordinal:1,started_at:new Date().toISOString()};
      const start=startAttempt(root,metadata);
      const row={...attemptRecord({agent:route,status:partial&&i===1?'timeout':'success'}, {runId:id,piece,inputHash:input,pieceHash:digest(piece),ordinal:1,durationMs:1,startedAt:metadata.started_at,attemptId:start.attempt_id}),start};
      return {...row,evidence:persistAttempt(root,row)};
    });
    const report={run_id:id,input_sha256:input,governor:'codex',findings:[],source_snapshot:{complete:true,files:[{path:'source.mjs',sha256:digest(fs.readFileSync(path.join(root,'source.mjs')))}]},
      gate_policy:{quorum_required:2,strict:false,requested_routes:['claude','grok']},attempt_evidence:rows,
      reviewers:[{agent:route,status:'success',review_contract:'momm-peer-review/2',reviewed_scope:[{quote:'synthetic',assessment:'fixture'}]}],
      split:{pieces:rows.map(row=>({id:row.piece,reviewers:{[route]:row.status}})),governor_direct:[]}};
    amend?.(report);
    const name=`.ensemble_reviews/reports/${id}.json`;write(name,report);
    fs.appendFileSync(path.join(root,'.ensemble_reviews/review-log.jsonl'),JSON.stringify({run_id:id,input_sha256:input,report_path:name,report_sha256:digest(fs.readFileSync(path.join(root,name)))})+'\n');
    return report;
  };
  make('rev_claims_1','claude',true);make('rev_claims_2','grok');make('rev_claims_3','claude');
  const inspected=inspectCompletion(root,'rev_claims_1');
  assert.equal(inspected.attempts.length,2,JSON.stringify(inspected.errors));
  assert(!inspected.errors.some(x=>/attempt/.test(x)),'started references are present in both the persisted record and report row');
  const partial=auditAttempts(root,['rev_claims_1','rev_claims_2']);
  assert.equal(partial.cumulative_quorum_met,false);assert.equal(partial.coverage[0].met,true);assert.equal(partial.coverage[1].met,false);
  const full=auditAttempts(root,['rev_claims_2','rev_claims_3']);assert.equal(full.cumulative_quorum_met,true);assert.equal(full.completion,false);
  make('rev_claims_missing_id','claude',false,report=>{
    const row=report.attempt_evidence[0]; delete row.attempt_id; delete row.start;
    const {evidence,...stored}=row; write(evidence.path,stored);
    evidence.sha256=digest(fs.readFileSync(path.join(root,evidence.path)));
  });
  make('rev_claims_strict_missing','claude',false,report=>{
    report.gate_policy={quorum_required:1,strict:true};
  });
  const boundaryChecks={
    governorRejectsMissingId:inspectCompletion(root,'rev_claims_missing_id').errors.some(x=>/attempt identity/.test(x)),
    auditRejectsMissingId:false, strictPolicyDiagnostic:false,
  };
  try {auditAttempts(root,['rev_claims_missing_id']);} catch(e) {boundaryChecks.auditRejectsMissingId=/attempt identity/.test(e.message);}
  try {auditAttempts(root,['rev_claims_strict_missing']);} catch(e) {boundaryChecks.strictPolicyDiagnostic=/strict policy/.test(e.message);}
  console.log(JSON.stringify(boundaryChecks));
  assert(Object.values(boundaryChecks).every(Boolean),'attempt identity and strict-policy boundaries must explicitly refuse malformed evidence');
  // Actual lock boundary rejects a missing custom_dirs before update/rollback can enter inventory.
  git(root,'init');const state=stateDir(root);fs.mkdirSync(state,{recursive:true});
  const lock={schema:'momm-lock/1',channel:'stable',installer:'install.mjs',targets:['codex']};
  fs.writeFileSync(path.join(state,'momm.lock'),JSON.stringify(lock));
  assert.throws(()=>readLock(root),/Invalid momm.lock/);
  fs.writeFileSync(path.join(state,'momm.lock'),JSON.stringify({...lock,custom_dirs:[]}));
  assert.deepEqual(readLock(root).custom_dirs,[]);
  // Both new modules already have real execution tests in attempts.test.mjs;
  // pin extra refusal boundaries requested by the review without inventing a defect.
  await assert.rejects(recordCheck(root,{runId:'rev_claims_1',test:'probe.mjs',timeout:10_000_000}),/timeout/);
  await assert.rejects(recordCheck(root,{runId:'rev_claims_1',test:'probe.mjs'},async()=>{write('source.mjs','export const x=2;\n');return {code:0,stdout:'changed',stderr:''};}),/changed during/);
  const mismatch=make('rev_claims_policy','grok');mismatch.gate_policy.quorum_required=3;
  // A fresh correctly sealed fixture, not mutation of an existing reviewed run.
  const policyId='rev_claims_different_policy';mismatch.run_id=policyId;
  // Differing input is rejected at identity comparison before attempt references are considered.
  mismatch.input_sha256=digest('different synthetic input');
  const policyName=`.ensemble_reviews/reports/${policyId}.json`;write(policyName,mismatch);
  fs.appendFileSync(path.join(root,'.ensemble_reviews/review-log.jsonl'),JSON.stringify({run_id:policyId,input_sha256:mismatch.input_sha256,report_path:policyName,report_sha256:digest(fs.readFileSync(path.join(root,policyName)))})+'\n');
  assert.throws(()=>auditAttempts(root,['rev_claims_1',policyId]),/different source/);
  console.log('PASS: persisted start references validate; split outcomes count by piece; malformed lock refused before inventory; check timeout/mutation and audit identity refuse');
} finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
