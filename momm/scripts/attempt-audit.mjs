#!/usr/bin/env node
// Explicit, offline cumulative coverage: hashes existing evidence; never rewrites reports or approvals.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest } from './governor.mjs';
import { requirePrivateEvidence } from './evidence-permissions.mjs';
const demand = (ok, text) => { if (!ok) throw new Error(text); };
export function auditAttempts(root, ids) {
  root = fs.realpathSync(root); requirePrivateEvidence(path.join(root,'.ensemble_reviews'));
  demand(ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length, 'choose 1–100 distinct runs');
  const read = (name, json = true) => {
    demand(typeof name === 'string' && name.startsWith('.ensemble_reviews/') && !name.includes('\\') && !name.includes(':') && name.split('/').every(x=>x && x!=='.' && x!=='..'), 'unsafe evidence reference');
    let file=root; for (const part of name.split('/')) {file=path.join(file,part); demand(!fs.lstatSync(file).isSymbolicLink(),'linked evidence refused');}
    const stat=fs.statSync(file); demand(stat.isFile() && stat.nlink===1 && stat.size<=8_000_000,'unbounded or hard-linked evidence');
    const bytes=fs.readFileSync(file);return {value:json?JSON.parse(bytes):bytes.toString('utf8'),path:name,sha256:digest(bytes)};
  };
  const log = read('.ensemble_reviews/review-log.jsonl', false).value.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const reports=[],attempts=[],pieces=new Map(); let identity=null;
  for(const id of ids) {
    demand(/^rev_[A-Za-z0-9_]+$/.test(id),'invalid run id');
    const report=read(`.ensemble_reviews/reports/${id}.json`),r=report.value;
    const seals = log.filter(entry => entry.run_id === id && !entry.event);
    demand(seals.length === 1 && seals[0].report_sha256 === report.sha256 && seals[0].input_sha256 === r.input_sha256 && seals[0].report_path === report.path, 'original report/log seal mismatch');
    demand(r.run_id===id && r.source_snapshot?.complete && r.attempt_evidence?.length,'run has no bound attempt evidence');
    const binding=JSON.stringify({input:r.input_sha256,source:r.source_snapshot,attachments:r.attachments??[],governor:r.governor,policy:r.gate_policy});
    if(identity===null)identity=binding;else demand(binding===identity,'different source, attachments, governor or gate policy; cannot combine');
    demand(!(r.split?.governor_direct?.length),'governor-direct pieces need separate adjudication, not cumulative approval');
    reports.push({path:report.path,sha256:report.sha256,run_id:id});
    const thisPieces=new Map();
    const expectedPieces=r.split?r.split.pieces.map(p=>p.id):['whole'], seen=new Set();
    demand(expectedPieces.length && new Set(expectedPieces).size===expectedPieces.length,'empty or duplicate piece set');
    for(const row of r.attempt_evidence) {
      demand(typeof row.attempt_id === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(row.attempt_id) && !seen.has(row.attempt_id),'missing or duplicate attempt identity');seen.add(row.attempt_id);
      demand(expectedPieces.includes(row.piece),'unknown attempt piece');
      const stored=read(row.evidence.path),{evidence,...expected}=row;
      if(row.start){const start=read(row.start.path);demand(start.sha256===row.start.sha256 && start.value.event==='started' && ['run_id','attempt_id','route','piece','input_sha256','piece_sha256','ordinal','started_at'].every(k=>start.value[k]===row[k]),'attempt start binding mismatch');}
      demand(stored.sha256===evidence.sha256 && JSON.stringify(stored.value)===JSON.stringify(expected) && row.run_id===id && row.input_sha256===r.input_sha256,'attempt hash or source mismatch');
      const p=thisPieces.get(row.piece)??{hash:row.piece_sha256,routes:new Set()};
      demand(p.hash===row.piece_sha256,'piece changed within a run');thisPieces.set(row.piece,p);
      const terminal=r.split ? r.split.pieces.find(x=>x.id===row.piece)?.reviewers[row.route] : r.reviewers.find(x=>x.agent===row.route)?.status;
      const verified=r.reviewers.find(x=>x.agent===row.route);
      if(row.outcome==='succeeded' && terminal==='success' && row.route!==r.governor && verified?.review_contract==='momm-peer-review/2' && verified.reviewed_scope?.length)p.routes.add(row.route);
      attempts.push({...row,report_sha256:report.sha256});
    }
    demand(expectedPieces.every(p=>thisPieces.has(p)),'missing piece attempt evidence');
    if(pieces.size)demand(JSON.stringify([...pieces.keys()].sort())===JSON.stringify([...thisPieces.keys()].sort()),'different piece sets');
    for(const [name,p] of thisPieces){const combined=pieces.get(name)??{hash:p.hash,routes:new Set()};demand(combined.hash===p.hash,'piece bytes changed across reruns');for(const route of p.routes)combined.routes.add(route);pieces.set(name,combined);}
  }
  const {policy,governor}=JSON.parse(identity),required=policy?.quorum_required;
  demand(Number.isInteger(required)&&required>0,'no explicit quorum policy');
  demand(!policy.strict || (Array.isArray(policy.requested_routes) && policy.requested_routes.length>0 && policy.requested_routes.every(x=>typeof x==='string' && x.trim().length>0)), 'invalid strict policy: requested_routes must name the required reviewer routes');
  const requiredRoutes=policy.strict?policy.requested_routes.filter(x=>x!==governor):[];
  const coverage=[...pieces].map(([piece,p])=>({piece,piece_sha256:p.hash,routes:[...p.routes].sort(),required,met:p.routes.size>=required && requiredRoutes.every(x=>p.routes.has(x))}));
  return {schema:'momm-attempt-audit/1',source_binding_sha256:digest(identity),reports,attempts,coverage,cumulative_quorum_met:coverage.length>0&&coverage.every(p=>p.met),completion:false,
    caveat:'Cumulative coverage only. This does not replace original per-run failures, disposition checks, final verification or release approval. Retrying one route never creates a second reviewer.'};
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))){
  try{const report=auditAttempts(process.cwd(),process.argv.slice(2));const name=`.ensemble_reviews/attempt-audit-${randomUUID()}.json`;fs.writeFileSync(name,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({path:name,sha256:digest(fs.readFileSync(name)),cumulative_quorum_met:report.cumulative_quorum_met,completion:false}));process.exitCode=report.cumulative_quorum_met?0:3;}
  catch(e){console.error(e.message);process.exitCode=1;}
}
