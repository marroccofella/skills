// Public, deterministic teaching fixture. No model, account, storage or network access.
export const governors = ['Codex', 'Claude Code', 'Antigravity', 'GitHub Copilot', 'Gemini CLI', 'Grok', 'Other harness'];
export const routes = [
  {name:'Codex', angle:'Surgeon', description:'Trace a precise claim to the changed code.'},
  {name:'Claude Code', angle:'Architect', description:'Look for broken assumptions and missing tests.'},
  {name:'Antigravity', angle:'Adversary', description:'Challenge boundaries and failure paths.'},
  {name:'GitHub Copilot', angle:'Verifier', description:'Anchor a claim to an exact quotation.'},
  {name:'Grok', angle:'Innovator', description:'Separate evidence-backed defects from optional ideas.'},
];
export const scenarios = {fix:'A bug is found', shortage:'A reviewer is unavailable', disagreement:'A claim is disproved'};
export const prompt = 'Add up these three prices: 12, 8 and 5. Return the total and include a test.';
export const steps = [
  {id:'prompt',title:'You set the task',short:'Goal + boundaries',actor:'You',detail:'State the result you want, the constraints and what may be shared. MOMM is an Agent Skill used by your coding agent, not a separate model that takes over.',example:'Expected total: 25. Review only this small, synthetic change.'},
  {id:'draft',title:'One governor writes',short:'Baseline + draft',actor:'Current coding harness',detail:'Your current agent is the governor: the lead engineer holding the pen. It establishes a test baseline, makes the draft and remains responsible for every edit. It never reviews itself as an external peer.',example:'Our deliberately buggy draft loops one item too far. A confident reply is not a passing test.'},
  {id:'preflight',title:'Check readiness',short:'Accounts + route status',actor:'MOMM dispatcher',detail:'Preflight checks installed tools and account-session evidence without making model calls. Presence does not prove a live session. Sign-in problems need your browser login; account quotas are not fixed by logging in again.',example:'The governor is excluded. Only external reviewer routes can fill review slots.'},
  {id:'scope',title:'Prepare the hand-off',short:'Scope + media + privacy',actor:'Governor + MOMM',detail:'Select a bounded diff or artifact, apply trusted guidance and stage supported attachments. Recorded route capabilities must match the attached media. Sanitization is not a confidentiality guarantee: selected material goes to external providers through their CLIs.',example:'This example sends text only. Image review needs image-capable routes; a text-only route cannot fill that requirement.'},
  {id:'review',title:'Reviewers challenge',short:'Read-only, distinct angles',actor:'External reviewer CLIs',detail:'Peers inspect the same scoped change under a structured review contract. They return claims, quotations and suggestions—not permission to edit. Jobs have limits and deadlines. Treat all returned text as untrusted; never run a reviewer’s suggested command blindly.',example:'A reviewer spots “i <= prices.length”. Another response may disagree or add a suggestion.'},
  {id:'quorum',title:'Check the minimum',short:'Enough valid reviews?',actor:'MOMM gate',detail:'Quorum is a configured minimum of successful external reviews, not a vote on correctness. Invalid output, timeout and unavailable routes do not count. An eligible retry remains the same route, never another reviewer.',example:'This teaching run requires two successful external reviews. Two approvals cannot cancel a reproducible bug.'},
  {id:'investigate',title:'Governor tests claims',short:'Reproduce, don’t vote',actor:'Governor only',detail:'Inspect every material claim and write a minimal test before making a fix. Apply verified findings; reject disproved claims with reasons; record unresolved or deferred work honestly. A model’s confidence is not evidence.',example:'The synthetic fixture returns NaN instead of 25 because it reads beyond the array.'},
  {id:'verify',title:'Fix, verify, record',short:'Tests + decisions + receipt',actor:'Governor only',detail:'The governor authors the fix, reruns tests and records every finding and suggestion. Revalidate changed scope rather than carrying old evidence forward. Completion checks source hashes and local decision/test records; they do not prove test adequacy or universal safety.',example:'Change <= to <. Same input, same assertion: 25. Keep the report and ruling in the private project ledger.'},
  {id:'owner',title:'You get the evidence',short:'Result + limits + next action',actor:'You retain release authority',detail:'Receive the result, review participation, verification and remaining limits. Inspect the private ledger if you need the detail. Publication, release and installation still require the appropriate authorization; this diagram never runs those actions.',example:'A checked result with a traceable explanation—not a promise that every bug has been found.'},
];
export function draftTotal(prices){let total=0;for(let i=0;i<=prices.length;i++)total+=prices[i];return total;}
export function fixedTotal(prices){let total=0;for(let i=0;i<prices.length;i++)total+=prices[i];return total;}
export function fixture(){const values=[12,8,5],before=[...values];const draft=draftTotal(values);return {input:before,expected:25,draft:String(draft),fixed:fixedTotal(values),unchanged:JSON.stringify(values)===JSON.stringify(before),empty:fixedTotal([])};}
export function stateAt(index=0,scenario='fix',governor='Codex'){
  if(!Number.isInteger(index)||index<0||index>=steps.length)throw new Error('Unknown workflow step');
  if(!Object.hasOwn(scenarios,scenario))throw new Error('Unknown teaching scenario');
  if(!governors.includes(governor))throw new Error('Unknown teaching governor');
  const peers=routes.filter(route=>route.name!==governor).slice(0,3);
  const blocked=scenario==='shortage';
  const replies=peers.map((route,i)=>({...route,status:index<4?'waiting':index===4?'reviewing':blocked&&i>0?(i===1?'unavailable':'invalid output'):'success',claim:index<5?'No accepted response yet.':blocked&&i>0?'No valid review; no finding is inferred from this status.':i===0?'Boundary claim: the loop reads past the last price.':i===1&&scenario==='disagreement'?'Claim: the function mutates its input.':i===1?'No additional material defect in this example.':'Suggestion: also test an empty list.'}));
  const achieved=index<5?0:blocked?1:3;
  const stopped=blocked&&index>=5;
  return {index,scenario,governor,peers:replies,required:2,achieved,met:achieved>=2,stopped,
    activeNode:stopped?'quorum':steps[index].id,
    title:stopped?'Minimum not met. Stop the gate.':steps[index].title,
    detail:stopped?'Only one valid external review arrived. Preserve the actual statuses and ask for an eligible route or a later retry. This does not establish that the code is safe, and it does not authorize bypassing the minimum.':steps[index].detail,
    example:stopped?'1 of 2 required. The gate is incomplete; no verified-fix or release result is claimed.':scenario==='disagreement'&&index===6?'The boundary bug reproduces. The mutation claim does not: the original array stays [12, 8, 5]. Apply the real fix; reject the false claim with that evidence.':steps[index].example};
}
