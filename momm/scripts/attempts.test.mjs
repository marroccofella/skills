import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { outcomeFor, OUTCOMES, attemptRecord, persistAttempt, attemptTotals } from './attempts.mjs';
import { privateTestFixture } from './private-test-fixture.mjs';
import { preparePrivateEvidence } from './evidence-permissions.mjs';
import { recordCheck } from './checks.mjs';
import { digest } from './governor.mjs';
import { auditAttempts } from './attempt-audit.mjs';
const root = privateTestFixture('momm-attempts-');
try {
  for (const [status, expected] of [['success', 'succeeded'], ['timeout','timeout'], ['quota','quota'], ['authentication_required','authentication_required'], ['ineligible_tier','ineligible_tier'], ['invalid_output','invalid_output'], ['empty','empty'], ['cancelled','cancelled'], ['provider_unavailable','provider_unavailable'], ['error','failed'], ['self_excluded','not_dispatched']]) { assert.equal(outcomeFor({ status }), expected); assert(OUTCOMES.includes(expected)); }
  assert.equal(outcomeFor({status:'invalid_output',detail:'reviewer did not return the required JSON schema — empty stdout'}),'empty');
  assert.throws(() => outcomeFor({status:'made_up'}), /Unclassified/);
  preparePrivateEvidence(path.join(root, '.ensemble_reviews'));
  const base = { runId: 'rev_fixture_1', inputHash: 'a'.repeat(64), pieceHash: 'b'.repeat(64), ordinal: 1, durationMs: 20, startedAt: new Date().toISOString() };
  const a = attemptRecord({agent:'claude',status:'invalid_output',usage:{reported:{total_tokens:20,cost_usd:0.02}}},base);
  const b = attemptRecord({agent:'claude',status:'success'}, {...base,ordinal:2,durationMs:30});
  for (const attempt_id of [undefined,null,123,'','x'.repeat(129)]) {
    assert.throws(()=>persistAttempt(root,{...a,attempt_id}),/Unsafe attempt identity/);
  }
  // Model another dispatcher creating the directory after this process's absent check.
  // A single event loop cannot interleave synchronous calls, but two processes can.
  const originalExists=fs.existsSync,attemptDir=path.join(root,'.ensemble_reviews/attempts');
  let interleaved=false;
  fs.existsSync=function(file){if(file===attemptDir&&!interleaved){interleaved=true;fs.mkdirSync(file,{mode:0o700});return false;}return originalExists(file);};
  try {assert.doesNotThrow(()=>persistAttempt(root,attemptRecord({agent:'grok',status:'timeout'},base)));}
  finally {fs.existsSync=originalExists;}
  const first = persistAttempt(root,a); persistAttempt(root,b);
  assert.throws(() => persistAttempt(root,a), /EEXIST/);
  assert.equal(digest(fs.readFileSync(path.join(root,first.path))),first.sha256);
  assert.deepEqual(attemptTotals([a,b]), [{route:'claude',attempts:2,duration_ms:50,cost_usd_reported:0.02,cost_coverage:'1 of 2',complete_cost:false}]);
  const write = (name, body) => { const at = path.join(root,name); fs.mkdirSync(path.dirname(at),{recursive:true,mode:0o700}); fs.writeFileSync(at,body,{mode:0o600}); };
  write('source.mjs','export const value = 1;\n');
  write('test.mjs','console.log("executed test"); process.exitCode = 7;\n');
  const report = {run_id:base.runId,input_sha256:base.inputHash,source_snapshot:{complete:true,files:[{path:'source.mjs',sha256:digest(fs.readFileSync(path.join(root,'source.mjs')))}]},attempt_evidence:[]};
  write(`.ensemble_reviews/reports/${base.runId}.json`,JSON.stringify(report));
  const opts = {runId:base.runId,phase:'before',test:'test.mjs'};
  const before = await recordCheck(root,opts); assert.equal(before.exit_code,7);
  const check = JSON.parse(fs.readFileSync(path.join(root,before.path)));
  assert.equal(check.exit_code,7); assert.equal(check.artifacts[0].sha256,check.artifacts[0].snapshot.sha256);
  assert.match(fs.readFileSync(path.join(root,check.output.path),'utf8'),/executed test/);
  write('test.mjs','console.log("passing test");\n');
  const final = await recordCheck(root,{...opts,phase:'final'}); assert.equal(final.exit_code,0);
  await recordCheck(root,{...opts,phase:'final'});
  assert.equal(fs.readdirSync(path.join(root,'.ensemble_reviews/verification')).length,2,'previous final check archived, not lost');
  await assert.rejects(recordCheck(root,{...opts,test:'../escape.mjs'}), /unsafe path/);
  const auditRun = (id,route) => {
    const row=attemptRecord({agent:route,status:'success'},{...base,runId:id});
    const evidence=persistAttempt(root,row);
    const value={...report,run_id:id,governor:'codex',gate_policy:{quorum_required:2},reviewers:[{agent:route,status:'success',review_contract:'momm-peer-review/2',reviewed_scope:[{synthetic:true}]}],attempt_evidence:[{...row,evidence}]};
    write(`.ensemble_reviews/reports/${id}.json`,JSON.stringify(value));
    fs.appendFileSync(path.join(root,'.ensemble_reviews/review-log.jsonl'),JSON.stringify({run_id:id,input_sha256:value.input_sha256,report_path:`.ensemble_reviews/reports/${id}.json`,report_sha256:digest(JSON.stringify(value))})+'\n',{mode:0o600});return value;
  };
  auditRun('rev_audit_1','claude');auditRun('rev_audit_2','claude');
  assert.equal(auditAttempts(root,['rev_audit_1','rev_audit_2']).cumulative_quorum_met,false,'retries are not independent reviewers');
  const other=auditRun('rev_audit_3','grok');
  const audited=auditAttempts(root,['rev_audit_1','rev_audit_3']);assert.equal(audited.cumulative_quorum_met,true);assert.equal(audited.completion,false);
  write('.ensemble_reviews/reports/rev_audit_3.json',JSON.stringify({...other,input_sha256:'c'.repeat(64)}));
  assert.throws(()=>auditAttempts(root,['rev_audit_1','rev_audit_3']),/seal mismatch/);
  console.log('PASS: closed outcomes, immutable attempts, failed cost/time, actual failing/passing test receipts and preserved history');
} finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:3}); }
