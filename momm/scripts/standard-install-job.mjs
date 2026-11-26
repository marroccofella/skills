import {providers} from './reviewer-providers.mjs';
import {standardReviewers} from './reviewer-install.mjs';

const ready = row => ['installed_verified', 'already_installed'].includes(row.status);
const workerStatuses = new Set([
  'installed_verified', 'already_installed', 'version_unverified', 'install_failed',
  'discovery_inconclusive', 'installer_busy', 'lock_unavailable'
]);

// Only known diagnostic categories leave the server. Vendor output may contain private paths.
function failureReason(reason, stderr) {
  if (reason === 'cleanup_unconfirmed') return reason;
  if (reason === 'ETIMEDOUT') return 'timeout';
  const diagnostic = String(reason) + '\n' + String(stderr || '');
  if (/unsupported (?:cpu )?architecture/i.test(diagnostic)) return 'architecture';
  if (/\bENOSPC\b/i.test(diagnostic)) return 'disk_full';
  if (/\b(?:EACCES|EPERM|UnauthorizedAccessException)\b/i.test(diagnostic)) return 'permission';
  if (/\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ENETUNREACH|ETIMEDOUT)\b/i.test(diagnostic)) return 'network';
  return /^exit \d{1,3}$/.test(reason) ? reason : 'installer_error';
}

async function runProvider(row, runOne) {
  row.status = 'checking_or_installing';
  row.started_at = Date.now();
  try {
    const result = await runOne(row.agent);
    if (result.timedOut) { row.status = 'timed_out'; return; }
    if (result.code !== 0) { row.status = 'worker_failed'; return; }
    const value = JSON.parse(result.stdout);
    if (value?.agent !== row.agent || !workerStatuses.has(value.status)) throw Error('Invalid worker result');
    row.status = value.status;
    if (typeof value.version === 'string' && /^\d+\.\d+\.\d+[a-z0-9.+-]{0,80}$/i.test(value.version)) row.version = value.version;
    if (ready(row) && !row.version) row.status = 'version_unverified';
    if (row.status === 'install_failed') row.reason = failureReason(value.reason, result.stderr);
  } catch { row.status = 'worker_failed'; }
  finally { row.finished_at = Date.now(); }
}

export function createStandardInstallJob(platform, runOne) {
  const plan = standardReviewers.map(agent => ({agent, label:providers[agent].label, command:providers[agent].install[platform]}));
  let state = {id:0, status:'idle', rows:[]};
  const snapshot = () => ({...state, plan, selective_retry:true, rows:state.rows.map(row => ({...row}))});
  async function work(job) {
    for (const row of job.rows) {
      if (row.status !== 'queued') continue;
      await runProvider(row, runOne);
      if (row.reason === 'cleanup_unconfirmed' || ['timed_out','worker_failed'].includes(row.status)) {
        for (const remaining of job.rows) if (remaining.status === 'queued') remaining.status = 'deferred';
        break;
      }
    }
    job.status = job.rows.every(ready) ? 'complete' : 'needs_attention';
  }
  function start(body) {
    if (!Array.isArray(body?.commands) || !body.commands.length || body.commands.some(command => !plan.some(item => item.command === command)))
      return {status:409,value:{error:'Refresh setup and confirm the current installer list.'}};
    if (body.previous_id !== state.id || state.status === 'running') return {status:200,value:snapshot()};
    const retry = body.retry_failed === true;
    const targets = retry ? plan.filter(item => state.rows.some(row => row.agent === item.agent && !ready(row))) : plan;
    if ((retry && state.status !== 'needs_attention') || targets.length !== body.commands.length || !targets.every((item,i) => item.command === body.commands[i]))
      return {status:409,value:{error:'Refresh setup and confirm the current installer list.'}};
    const rows = retry ? state.rows.map(row => ready(row) ? {...row} : {agent:row.agent,status:'queued'})
      : plan.map(({agent}) => ({agent,status:'queued'}));
    state = {id:state.id+1,status:'running',rows};
    void work(state);
    return {status:202,value:snapshot()};
  }
  return {snapshot,start,get running(){return state.status === 'running';}};
}
