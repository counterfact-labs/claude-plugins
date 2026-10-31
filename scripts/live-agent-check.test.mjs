import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startBridge } from './live-agent-bridge.mjs';
import { uploadFinding, uploadPayload } from './live-agent-test-fixtures.mjs';
import { credentialRefusalMessage, credentialProposalRefusalMessage } from './live-agent-cases.mjs';

const script = fileURLToPath(new URL('./live-agent-check.mjs', import.meta.url));
const fixtureDir = fileURLToPath(new URL('./fixtures/live-agent/', import.meta.url));
const fixtureSource = join(fixtureDir, 'system_prompt.md');

// The real harness, stdio adapter, credential adapter and HTTP budget gate run.
// Only coding agents, npm and the remote console transport are replaced.
const executable = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE;
const uploadFinding = ${uploadFinding.toString()};
const noAgentMessage = ${JSON.stringify(credentialRefusalMessage)};
const proposalMessage = ${JSON.stringify(credentialProposalRefusalMessage)};
const skippedPromptMessage = 'Counterfact skipped system_prompt.md because it appears to contain a credential, so no agent prompt was left to analyze. Remove the credential and try again.';
const log = value => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(value) + '\\n');
log({name, args, home: process.env.HOME, cwd: process.cwd(), keyPresent: !!process.env.COUNTERFACT_LIVE_TEST_KEY,
  prompt: fs.existsSync('system_prompt.md') ? fs.readFileSync('system_prompt.md', 'utf8') : null,
  codexHome: process.env.CODEX_HOME, claudeHome: process.env.CLAUDE_CONFIG_DIR, npmCache: process.env.npm_config_cache});
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');

function analysisUrl(emptyCase) {
  if (emptyCase && mode === 'empty-wrong-url') return 'https://app.counterfactlabs.com/projects/other/findings';
  return 'https://app.counterfactlabs.com/projects/project-1/findings';
}
function analysisText(emptyCase, noUrl, url, findings) {
  if (mode === 'finding-no-url' && findings.length > 0) return 'Findings: fictional unsafe operation';
  if (!emptyCase) {
    const coverage = mode === 'coverage-present' ? 'Checked: system_prompt.md\\n' : '';
    return coverage + (mode === 'no-summary' ? '' : 'No findings.\\nFull results: '+url+'\\n');
  }
  if (mode === 'empty-missing-summary') return '';
  let summary = 'No findings.\\n';
  if (['empty-legacy','empty-missing-result','empty-conflicting-result'].includes(mode)) summary = '';
  else if (mode.includes('coverage')) summary = 'No findings in the 1 agent file this analysis read.\\n';
  if (!noUrl) summary += 'Full results: '+url+'\\n';
  if (mode === 'empty-wrong-text-url') summary += 'Full results: https://app.counterfactlabs.com/projects/other/findings';
  return summary;
}
function resultCoverage(emptyCase) {
  if (mode.startsWith('coverage-')) return {coverage: mode === 'coverage-present' ? {filesAnalyzed:1} : null};
  if (emptyCase && mode.includes('coverage')) return {coverage:{filesAnalyzed:1}};
  return {};
}
function resultFindings(emptyCase) {
  if (!emptyCase) return {findings:[]};
  if (mode === 'empty-missing-result') return {};
  if (mode === 'empty-conflicting-result') return {findingIds:[],findings:[{id:'unexpected'}]};
  return {findingIds:[]};
}
function finalAgentText(refused, emptyCase) {
  if (refused) return mode === 'credential-paraphrase' ? 'The prompt was skipped, so no analysis started.' : noAgentMessage;
  if (emptyCase && mode === 'empty-unrelated-final') return 'Done.';
  if (emptyCase && mode.includes('no-url')) return 'No findings.';
  return 'No findings. https://app.counterfactlabs.com/projects/project-1/findings';
}
function codexToolStatus(result) {
  if (result?.isError && mode === 'credential-unfinished-tool') return 'in_progress';
  if (mode === 'tool-status-failed' || result?.isError && mode !== 'credential-completed-tool') return 'failed';
  return 'completed';
}
if (name === 'npx') {
  if (args.includes('--help')) { console.log('Usage: analyze'+(mode.startsWith('cap-')?' --max-dollars':'')); return; }
  if (args.includes('analyze')) {
    const finish=()=>{console.error("This analysis costs more than the limit you set, so it didn't start. Nothing was charged.");process.exitCode=1;};
    if(mode.startsWith('cap-')) {
      const call=(route,body)=>fetch('https://app.counterfactlabs.com/api/cli/'+route,{method:'POST',body:JSON.stringify(body)}).then(async r=>{if(!r.ok)throw Error('refused');return r.json();});
      (async()=>{
        await call('checks',{});
        const created=await call('relay-reservations',{action:'create'});
        const reserved=await call('relay-reservations',{action:'reserve',reservationId:created.reservationId});
        log({name:'cap-reservation',token:reserved.reservationToken});
        if(mode==='cap-unsafe')await call('checks/local',{reservationId:created.reservationId});
        await call('relay-reservations',{action:'fail',reservationId:created.reservationId});
        finish();
      })().catch(()=>{console.error('Cap probe transport failed');process.exitCode=1;});
    }
    else finish();return;
  }
  const pending = new Map();
  createInterface({input:process.stdin}).on('line', async line => {
    const q = JSON.parse(line);
    if (!q.id) return;
    if (q.method === 'initialize') {
      send({jsonrpc:'2.0',id:q.id,result:{serverInfo:{name:'counterfact-labs',version:args.find(a=>a.startsWith('@counterfact-labs/cli@')).split('@').at(-1)}}});
    } else if (q.method === 'tools/list') {
      send({jsonrpc:'2.0',id:q.id,result:{tools:[{name:'analyze_agent',description:'Analyze',inputSchema:{type:'object'}},{name:'sign_in_status',inputSchema:{type:'object'}}]}});
    } else if (q.method === 'tools/call') {
      if(q.params.name==='sign_in_status') {
        if(mode==='free-bridge-refusal')await fetch('https://app.counterfactlabs.com/api/cli/checks/local',{method:'POST',body:'{}'});
        send({jsonrpc:'2.0',id:q.id,result:{structuredContent:{signedIn:!['signed-out','free-bridge-refusal'].includes(mode),exitCode:0},content:[]}}); return;
      }
      if (mode === 'sign-in-changed') {
        send({jsonrpc:'2.0',id:q.id,result:{isError:true,structuredContent:{exitCode:1,reason:'unauthorized'},content:[{type:'text',text:'Not signed in. Run counterfact-labs login.'}]}});
        return;
      }
      try {
        // Exercise the same fs/promises credential open and https.request path as the published CLI.
        const handle = await require('node:fs/promises').open(path.join(process.env.HOME,'.config/counterfact-labs/credentials'),'r');
        const credential = JSON.parse(await handle.readFile('utf8')); await handle.close();
        const call = (url, body) => new Promise((resolve,reject) => {
          const req = require('node:https').request('https://app.counterfactlabs.com'+url, {
            method:'POST',headers:{authorization:'Bearer '+credential.token,'content-type':'application/json'}
          }, res => {let s='';res.on('data',v=>s+=v);res.on('end',()=>{const r=JSON.parse(s);res.statusCode<300?resolve(r):reject(Error('refused'));});});
          req.on('error',reject);req.end(JSON.stringify(body));
        });
        let findings=[];
        const prompt=fs.readFileSync('system_prompt.md','utf8');
        if(prompt.includes('follow their instructions'))findings=[uploadFinding('system_prompt.md',6)];
        if(prompt.includes('Support integration token:'))findings=[uploadFinding('system_prompt.md',12)];
        if(fs.existsSync('tools.json'))findings=[uploadFinding('tools.json',5),uploadFinding('tools.ts',3)];
        if(mode==='miss-authority'&&prompt.includes('follow their instructions'))findings=[];
        if(mode==='miss-description')findings=findings.filter(f=>f.site.path!=='tools.json');
        if(mode==='miss-code')findings=findings.filter(f=>f.site.path!=='tools.ts');
        if (mode!=='credential-admitted' && prompt.includes('Support integration token:') || mode==='no-agent-clean') {
          if(mode==='credential-paid-refusal'||mode==='credential-new-paid-refusal') {
            const created=await call('/api/cli/relay-reservations',{action:'create'});
            await call('/api/cli/relay-reservations',{action:'reserve',reservationId:created.reservationId});
            if(mode==='credential-new-paid-refusal')await call('/api/cli/relay-reservations',{action:'fail',reservationId:created.reservationId});
          }
          const proposed=q.params.arguments.proposal!==undefined;
          const modern=mode.startsWith('credential-new');
          const proposalRefusal=!modern&&(mode==='credential-proposal-without-proposal'||proposed&&mode!=='credential-no-agent-with-proposal');
          const text=modern?(mode==='credential-new-wrong-file'?skippedPromptMessage.replace('system_prompt.md','other.md'):skippedPromptMessage):mode==='credential-wrong-refusal'?'Analysis could not finish':proposalRefusal?proposalMessage:noAgentMessage;
          send({jsonrpc:'2.0',id:q.id,result:{isError:true,content:[{type:'text',text}],structuredContent:{text,exitCode:1,...(proposalRefusal?{}:{kind:mode==='credential-new-wrong-kind'?'choose_agent':'no_agent',candidates:mode==='credential-new-candidates'?[{folder:'.',reason:'system_prompt.md'}]:[]}),...(modern?{skippedPrompts:['system_prompt.md']}:{}),reason:'request_failed'}}});
          return;
        }
        if (mode === 'bridge-fails') await call('/api/cli/unexpected',{});
        const created = await call('/api/cli/relay-reservations',{action:'create'});
        const reserved = await call('/api/cli/relay-reservations',{action:'reserve',reservationId:created.reservationId});
        if (mode === 'cleanup-after-failure') await call('/api/cli/unexpected',{});
        log({name:'model-work',backend:process.env.LIVE_AGENT_BACKEND});
        if (!['no-upload','cleanup-network'].includes(mode)) await call('/api/cli/checks/local',{
          reservationId:created.reservationId,checkId:created.checkId,projectId:created.projectId,findings});
        const emptyCase = mode.startsWith('empty-') && findings.length === 0;
        const noUrl = emptyCase && mode.includes('no-url') || mode === 'finding-no-url' && findings.length > 0;
        const resultUrl = analysisUrl(emptyCase);
        const text = analysisText(emptyCase, noUrl, resultUrl, findings);
        send({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text}],isError:mode==='tool-error',
          structuredContent:{text,...resultCoverage(emptyCase),exitCode:0,...(noUrl?{}:{url:resultUrl}),...(mode==='cli-029'||mode==='optional-mcp-ids'?{}:{analysisId:mode==='mismatched-analysis'?'other-analysis':'analysis-1',projectId:mode==='mismatched-project'?'other-project':'project-1'}),...resultFindings(emptyCase)}}});
      } catch { send({jsonrpc:'2.0',id:q.id,result:{isError:true,content:[{type:'text',text:'Analysis refused'}],structuredContent:{exitCode:1,text:'Analysis refused'}}}); }
    }
  });
} else if (name === 'claude' && args[0] === 'plugin') {
  if (mode === 'install-fails') process.exit(2);
  if (args[1] === 'install') {
    const p=path.join(process.env.HOME,'.claude/plugins/cache/counterfact-labs/counterfact/9.8.7');
    fs.mkdirSync(p,{recursive:true});
    fs.writeFileSync(path.join(p,'.mcp.json'),JSON.stringify({mcpServers:{counterfact:{command:'npx',args:mode==='plugin-config-changed'?['--yes','@counterfact-labs/cli@9.8.7','mcp']:['-y',...(['plugin-prefix','cli-029'].includes(mode)?['--prefix=\${CLAUDE_PLUGIN_ROOT}']:[]),'@counterfact-labs/cli@9.8.7','mcp']}}}));
    fs.writeFileSync(path.join(process.env.HOME,'.claude/plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'counterfact@counterfact-labs':[{installPath:p,version:'9.8.7',scope:'user'}]}}));
  }
} else {
  if (mode === 'hang') { setInterval(()=>{},1000); return; }
  if (mode === 'agent-fails' && name === 'claude') process.exit(3);
  const done = () => {
    const refused=mode!=='credential-admitted'&&fs.readFileSync('system_prompt.md','utf8').includes('Support integration token:')||mode==='no-agent-clean';
    const emptyCase=mode.startsWith('empty-')&&!fs.existsSync('tools.json')&&!fs.readFileSync('system_prompt.md','utf8').includes('follow their instructions')&&!refused;
    const finalText=finalAgentText(refused,emptyCase);
    const failed=refused&&['credential-failed-turn','credential-failed-tool-turn'].includes(mode)||emptyCase&&mode==='empty-failed-turn';
    if (name === 'claude') send({type:'result',subtype:failed?'error_during_execution':'success',is_error:failed,result:finalText,total_cost_usd:0.04});
    else {send({type:'item.completed',item:{type:'agent_message',text:finalText}});send({type:failed?'turn.failed':'turn.completed',usage:{input_tokens:12,output_tokens:4}});}
  };
  if (mode === 'claims-only') {done();return;}
  if (name === 'claude') send({type:'system',subtype:'init',mcp_servers:[{name:'plugin:counterfact:counterfact',status:'connected'}],plugins:[{name:'counterfact'}]});
  const pin=name==='claude'?'@counterfact-labs/cli@9.8.7':'@counterfact-labs/cli@latest';
  if (name === 'codex') {
    const config=fs.readFileSync(path.join(process.env.CODEX_HOME,'config.toml'),'utf8');
    log({name:'codex-config',text:config});
    if (!config.includes(pin) || !config.includes('tool_timeout_sec = 900')) process.exit(7);
  }
  const launchArgs=name==='claude'&&['plugin-prefix','cli-029'].includes(mode)?['-y','--prefix='+path.join(process.env.HOME,'.claude/plugins/cache/counterfact-labs/counterfact/9.8.7'),pin,'mcp']:['-y',pin,'mcp'];
  const child=spawn('npx',launchArgs,{stdio:['pipe','pipe','inherit']});
  child.on('error',()=>process.exit(8));
  const write = q=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...q})+'\\n');
  createInterface({input:child.stdout}).on('line',line=>{
    const r=JSON.parse(line);
    if (r.id===1) {write({method:'notifications/initialized'});write({id:4,method:'tools/list'});}
    else if(r.id===4) {write({id:2,method:'tools/call',params:{name:mode.startsWith('disallowed-')?mode.slice('disallowed-'.length):'analyze_agent',arguments:{path:process.cwd(),...(name==='claude'?{proposal:{agentName:'Paper shop assistant',files:[{path:['credential-invalid-proposal','credential-new-invalid-proposal'].includes(mode)?'../outside.md':mode==='credential-unrelated-proposal'?'other.md':mode==='credential-relative-proposal'?'./system_prompt.md':'system_prompt.md',role:'prompt'}]}}:{})}}});}
    else if (r.id===2) {
      if (mode==='bridge-fails'&&!fs.readFileSync('system_prompt.md','utf8').includes('Support integration token:')) {setInterval(()=>{},1000);return;}
      if (mode==='duplicate') {write({id:3,method:'tools/call',params:{name:'analyze_agent',arguments:{path:process.cwd()}}});return;}
      if(name==='codex'&&!(mode==='credential-no-tool-event'&&fs.readFileSync('system_prompt.md','utf8').includes('Support integration token:')))send({type:'item.completed',item:{type:'mcp_tool_call',server:r.result?.isError&&mode==='credential-wrong-server'?'other':'counterfact',tool:r.result?.isError&&mode==='credential-wrong-tool'?'get_balance':'analyze_agent',status:codexToolStatus(r.result),result:r.result}});
      child.stdin.end();done();
    } else if(r.id===3){child.stdin.end();done();}
  });
  write({id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name,version:'1'}}});
}
`;

function reserveReply(overrides = {}) {
  return {
    reservationId: 'reservation-1', checkId: 'check-1', projectId: 'project-1',
    state: 'reserved', settlement: 'held', reason: null, uploadState: 'missing',
    quoteId: 'quote-1', priceMicro: 1000000, providerBudgetMicro: 2000000,
    expiresAt: '2026-10-30T12:10:00.000Z', absoluteExpiresAt: '2026-10-30T12:30:00.000Z',
    deadlineClassification: null, reservationToken: 'fictional-capability', ...overrides,
  };
}

const upstream = `
import { appendFileSync } from 'node:fs';
const original=globalThis.fetch;
const reserveReply=${reserveReply.toString()};
let count=0;
globalThis.fetch=async (input,options={})=>{
  const url=String(input);
  const requested=new URL(url);
  const isBridge=process.env.LIVE_AGENT_BRIDGE && requested.origin===new URL(process.env.LIVE_AGENT_BRIDGE).origin;
  const isConsole=requested.hostname==='app.counterfactlabs.com';
  if (!isBridge && !isConsole) return {status:process.env.FAKE_MODE==='cli-029'&&url==='https://www.npmjs.com/package/@counterfact-labs/cli'?403:200,url};
  if (!isConsole) return original(input,options);
  const headers=new Headers(options.headers);
  if(headers.get('authorization')!=='Bearer fictional-live-key') throw Error('wrong runtime sign-in');
  const body=options.body?JSON.parse(options.body):{};
  appendFileSync(process.env.FAKE_LOG,JSON.stringify({name:'console',path:new URL(url).pathname,action:body.action})+'\\n');
  if(body.action==='reserve'&&process.env.FAKE_MODE==='refused-slow-reserve')await new Promise(resolve=>setTimeout(resolve,1300));
  let result;
  if(body.action==='create') result={reservationId:'reservation-'+(++count),checkId:'check-'+count,projectId:'project-1',state:'quoted'};
  else if(body.action==='reserve') {
    const mode=process.env.FAKE_MODE;
    result=reserveReply({reservationId:body.reservationId,checkId:'check-'+count,
      priceMicro:['unpriced-plan','unknown-price','invalid-release-network'].includes(mode)?null:mode==='free-personal'?0:mode==='priced-personal'?1990000:mode==='over-cap'||mode.startsWith('refused-')?6000000:mode==='total-cap'?4000000:1000000,
      providerBudgetMicro:['unknown-price','invalid-release-network'].includes(mode)?null:mode==='free-personal'||mode==='priced-personal'?25000000:2000000});
  }
  else if(body.action==='fail') {
    const mode=process.env.FAKE_MODE;
    if(mode.startsWith('refused-')||mode==='invalid-release-network'||mode.startsWith('cleanup-')) {
      // Delay the refusal so a report written before cleanup completes loses it.
      await new Promise(resolve=>setTimeout(resolve,mode==='refused-slow-network'?1300:150));
      if(mode==='refused-status')return Response.json({error:'release refused'},{status:503});
      if(mode==='refused-settlement')return Response.json({reservationId:body.reservationId,state:'reserved',settlement:'held'});
      if(mode==='refused-timeout')throw new DOMException('fictional-live-key release timeout','TimeoutError');
      throw Error('fictional-live-key release network failure');
    }
    result={reservationId:body.reservationId,state:'closed',settlement:'released'};
  }
  else if(url.endsWith('/checks/local'))result={checkId:body.checkId,projectId:body.projectId,analysisId:'analysis-1',findingIds:process.env.FAKE_MODE==='dropped-findings'?[]:(body.findings??[]).map((_,i)=>'finding-'+i),settlement:'charged'};
  else result={mode:'local',minimumLocalCliVersion:'0.2.9'};
  return Response.json(result);
};
`;

async function run(t, args = ['run', '--confirm-paid'], mode = 'ok', key = 'fictional-live-key', emptyPath = false, agentDir = fixtureDir) {
  const root = mkdtempSync(join(tmpdir(), 'live-agent-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const log = join(root, 'calls.jsonl'); writeFileSync(log, '');
  for (const name of emptyPath ? ['claude','codex'] : ['claude','codex','npx']) {
    writeFileSync(join(bin,name), executable); chmodSync(join(bin,name),0o755);
  }
  if (emptyPath) {
    writeFileSync(join(root,'npx'), executable, {mode:0o755});
    for (const name of ['bash','node','dirname']) {
      symlinkSync(name === 'node' ? process.execPath : '/usr/bin/'+name, join(bin,name));
    }
  }
  const loader = join(root, 'upstream.mjs'); writeFileSync(loader,upstream);
  const env={...process.env,PATH:emptyPath ? ':'+bin : bin+':'+process.env.PATH,FAKE_LOG:log,FAKE_MODE:mode,
    NODE_OPTIONS:'--import='+loader,COUNTERFACT_LIVE_TEST_KEY:key,TMPDIR:root,GITHUB_STEP_SUMMARY:join(root,'summary.md'),
    CODEX_HOME:join(root,'original-codex'),CLAUDE_CONFIG_DIR:join(root,'original-claude'),
    CF_CONSOLE_URL:'https://do-not-use.invalid',COUNTERFACT_URL:'https://do-not-use.invalid',
    ANTHROPIC_API_KEY:'fictional-provider-key',CODEX_API_KEY:'fictional-provider-key'};
  const started=Date.now();
  const child=spawn(process.execPath,[script,...args,...(agentDir ? ['--agent-dir',agentDir] : [])],{env,cwd:root,detached:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{ /* Already exited. */ }};
  t.after(kill);
  const timer=setTimeout(kill,45000);
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  const calls=readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  return {status,stdout,stderr,calls,root,duration:Date.now()-started};
}

for (const mode of ['empty-legacy', 'empty-coverage']) test('accepts completed clean results with the matching URL '+mode, async t => {
  const r = await run(t, undefined, mode);
  assert.equal(r.status, 0, r.stdout+r.stderr);
  for (const backend of ['Claude', 'Codex']) assert.match(r.stdout, new RegExp('PASS '+backend+' \\| clean \\| Analysis completed; coverage '+(mode.includes('coverage')?'present':'not yet available')));
  assert.equal(r.calls.filter(c => c.name === 'model-work').length, 6);
  assert.equal(r.calls.filter(c => c.name === 'console' && c.action === 'reserve').length, 6);
});
for (const mode of ['empty-no-url', 'empty-no-url-coverage', 'empty-wrong-url', 'empty-missing-summary', 'empty-missing-result', 'empty-unrelated-final', 'empty-failed-turn', 'empty-wrong-text-url', 'empty-conflicting-result']) test('rejects incomplete or mismatched clean results '+mode, async t => {
  const r = await run(t, undefined, mode);
  assert.equal(r.status, 1, r.stdout+r.stderr);
  for (const backend of ['Claude', 'Codex']) assert.match(r.stdout, new RegExp('FAIL '+backend+' \\| clean \\|'));
});
test('findings still require the matching tool URL in both agents', async t => {
  const r = await run(t, undefined, 'finding-no-url');
  assert.equal(r.status, 1, r.stdout+r.stderr);
  for (const backend of ['Claude', 'Codex']) for (const id of ['planted-authority', 'tools-agent']) {
    assert.match(r.stdout, new RegExp('FAIL '+backend+' \\| '+id+' \\| .*Missing CLI summary or console findings URL'));
  }
});
for (const mode of ['credential-refusal', 'credential-new', 'credential-completed-tool']) test('accepts verified credential refusal with a finished Codex tool event '+mode, async t => {
  const r = await run(t, undefined, mode);
  assert.equal(r.status, 0, r.stdout+r.stderr);
  assert.match(r.stdout, /PASS Codex \| planted-credential \| Credential-containing prompt refused before reservation; charged \$0.00/);
  assert.equal(r.calls.filter(c => c.name === 'console' && c.action === 'reserve').length, 6);
});
for (const mode of ['credential-unfinished-tool', 'credential-wrong-server', 'credential-wrong-tool', 'credential-failed-tool-turn', 'tool-status-failed']) test('rejects an unverified Codex completion '+mode, async t => {
  const r = await run(t, undefined, mode);
  assert.equal(r.status, 1, r.stdout+r.stderr);
  assert.match(r.stdout, new RegExp('FAIL Codex \\| '+(mode==='tool-status-failed'?'clean':'planted-credential')+' \\| .*Codex did not return completed MCP results and URL'));
});

test('check without an agent directory preserves the existing local default',async t=>{
  const r=await run(t,['check'],'ok','',false,null);
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.calls,[]);
  assert.match(r.stdout,/Copy \S*scripts\/fixtures\/live-agent separately/);
  assert.match(r.stdout,/Total Counterfact analysis estimate cap: \$15\.00\. Per-analysis ceiling \$5\.00; up to six analyses\./);
});

test('custom agent directory is previewed and copied independently for both providers',async t=>{
  const source=mkdtempSync(join(tmpdir(),'live custom agent-'));
  t.after(()=>rmSync(source,{recursive:true,force:true}));
  const prompt='You assist a fictional paper shop with notebook questions.\n';
  writeFileSync(join(source,'system_prompt.md'),prompt);
  const preview=await run(t,['check'],'ok','',false,source);
  assert.equal(preview.status,0,preview.stderr);
  assert.ok(preview.stdout.includes(source));assert.deepEqual(preview.calls,[]);
  const r=await run(t,undefined,'ok','fictional-live-key',false,source);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const agents=r.calls.filter(c=>c.name==='claude'&&c.args.includes('-p')||c.name==='codex');
  assert.equal(agents.length,8);
  for(const agent of agents.filter(a=>a.cwd.includes('/clean/')))assert.equal(agent.prompt,prompt);
  assert.equal(readFileSync(join(source,'system_prompt.md'),'utf8'),prompt);
});

for(const value of ['', '--max-dollars'])test('rejects invalid agent directory '+JSON.stringify(value),async t=>{
  const r=await run(t,['check','--agent-dir',value]);
  assert.notEqual(r.status,0);assert.match(r.stderr,/Invalid --agent-dir/);assert.deepEqual(r.calls,[]);
});

test('check describes published installs, both prompts, isolation and cost gate without launching tools',async t=>{
  const r=await run(t,['check','--max-dollars','2.50'],'ok','');
  assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[]);
  for(const pattern of [/claude plugin marketplace add.*main/,/claude plugin install counterfact@counterfact-labs/,/claude -p/,/codex exec/,/@counterfact-labs\/cli@latest/,/2\.50/,/--confirm-paid/,/COUNTERFACT_LIVE_TEST_KEY/,/scripts\/fixtures\/live-agent/,/No network/])assert.match(r.stdout,pattern);
});

test('preview explains Codex MCP approval and the priceMicro gate',async t=>{
  const r=await run(t,['check'],'ok','');
  assert.equal(r.status,0,r.stderr);assert.deepEqual(r.calls,[]);
  assert.match(r.stdout,/Codex config:.*approval_policy=never.*default_tools_approval_mode=approve/);
  assert.match(r.stdout,/Withhold each reservation capability until its priceMicro is a nonnegative safe integer and the combined price fits the cap; otherwise release the hold before model work\./);
  assert.doesNotMatch(r.stdout,/providerBudgetMicro|workspace allowance|provider budget/);
});

for(const [args,key,pattern] of [
  [['run'],'fictional-live-key',/--confirm-paid/],
  [['run','--confirm-paid'],'',/COUNTERFACT_LIVE_TEST_KEY/],
  [['check','--max-dollars','NaN'],'',/max-dollars/],
  [['run','--confirm-paid','--max-dollars','0'],'fictional-live-key',/max-dollars/],
  [['check','--unknown'],'',/Usage/],
])test('refuses invalid invocation '+args.join(' ')+(!key?' without key':''),async t=>{
  const r=await run(t,args,'ok',key);assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,pattern);assert.deepEqual(r.calls,[]);
});

test('both released integrations complete with isolated homes, real MCP evidence, receipts and charges',async t=>{
  const before=readFileSync(fixtureSource,'utf8');
  const r=await run(t);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/PASS.*Claude/);assert.match(r.stdout,/PASS.*Codex/);
  assert.match(r.stdout,/\$1\.00/);assert.match(r.stdout,/\$0\.04/);assert.match(r.stdout,/duration|[0-9.]+s/);
  assert.match(r.stdout,/charged \(equals estimate\) \$1\.00/);
  assert.match(r.stdout,/https:\/\/app\.counterfactlabs\.com\/projects\/project-1\/findings/);
  const agents=r.calls.filter(c=>c.name==='claude'&&c.args.includes('-p')||c.name==='codex');assert.equal(agents.length,8);
  assert.notEqual(agents[0].home,agents[4].home);
  for(const a of agents){assert.equal(a.keyPresent,false);assert.ok(a.cwd.startsWith(a.home.slice(0,a.home.lastIndexOf('/'))));assert.equal(existsSync(a.home),false);assert.equal(existsSync(a.cwd),false);}
  assert.equal(r.calls.filter(c=>c.name==='npx'&&c.args.at(-1)==='mcp').length,10);
  assert.equal(readFileSync(fixtureSource,'utf8'),before);
  assert.ok(!r.stdout.includes('fictional-live-key')&&!r.stderr.includes('fictional-live-key'));
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
});

test('headless Codex receives MCP approval in its counterfact server config',async t=>{
  const r=await run(t);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const config=r.calls.find(c=>c.name==='codex-config')?.text;
  assert.equal(typeof config,'string');
  assert.match(config,/^approval_policy = "never"$/m);
  assert.match(config,/^sandbox_mode = "read-only"$/m);
  const server=config.split('[mcp_servers.counterfact]\n')[1]?.split(/\n\[/)[0]??'';
  assert.match(server,/^default_tools_approval_mode = "approve"$/m);
});

test('null price with a valid provider budget fails as an unpriced test account before model work',async t=>{
  const r=await run(t,undefined,'unpriced-plan');
  assert.equal(r.status,1,r.stdout+r.stderr);
  for(const name of ['Claude','Codex']) {
    const row=r.stdout.split('\n').find(line=>line.startsWith('FAIL '+name));
    assert.ok(row?.endsWith('Analysis reservation priceMicro is unavailable; the test account is not on a priced plan'),r.stdout);
  }
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,0);
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.action==='fail').length,6);
  assert.doesNotMatch(r.stdout+r.stderr,/fictional-live-key|fictional-capability/);
});

test('six Personal prices fit the shared fifteen dollar cap regardless of provider budgets',async t=>{
  const r=await run(t,undefined,'priced-personal');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/total Counterfact cap \$15\.00/);
  assert.equal(r.stdout.match(/estimate \$1\.99; charged \(equals estimate\) \$1\.99/g)?.length,6);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  assert.doesNotMatch(r.stdout,/workspace allowance|provider budget/);
});

test('free Personal reservations count their zero price rather than the provider budget',async t=>{
  const r=await run(t,['run','--confirm-paid','--max-dollars','0.000001'],'free-personal');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stdout.match(/estimate \$0\.00; charged \(equals estimate\) \$0\.00/g)?.length,6);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
});

for(const mode of ['over-cap','unknown-price','total-cap'])test('withholds model work and releases the hold for '+mode,async t=>{
  const r=await run(t,undefined,mode);assert.notEqual(r.status,0,r.stdout);assert.match(r.stdout,/FAIL/);
  assert.match(r.stdout,mode==='unknown-price'?/Analysis reservation priceMicro is unavailable; the test account is not on a priced plan/
    :mode==='over-cap'?/Per-analysis priceMicro exceeds the \$5 cap/:/Total analysis priceMicro exceeds the cap/);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,mode.endsWith('total-cap')?3:0);
  assert.ok(r.calls.some(c=>c.name==='console'&&c.action==='fail'));
});

for(const [label,overrides,field] of [
  ['null price with a valid provider budget',{priceMicro:null},'priceMicro'],
  ['missing price',{priceMicro:undefined},'priceMicro'],
  ...[-1,1.5,Number.MAX_SAFE_INTEGER+1,'reply-value-must-stay-private',{}].map(value=>['invalid price '+JSON.stringify(value),{priceMicro:value},'priceMicro']),
  ['invalid state',{state:'reply-value-must-stay-private'},'state'],
  ['invalid settlement',{settlement:'reply-value-must-stay-private'},'settlement'],
  ['mismatched reservation',{reservationId:'reply-value-must-stay-private'},'reservationId'],
])test('reserve refusal identifies the field and releases before failing: '+label,async t=>{
  const original=globalThis.fetch;
  const budget={used:0,cap:5000000};
  const bridge=await startBridge({key:'fictional-live-key',budget,folder:resolve(fixtureDir)});
  t.after(()=>bridge.close());
  let released=false;
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);
    if(body.action==='reserve')return Response.json(reserveReply(overrides));
    assert.equal(body.action,'fail');assert.equal(body.reservationId,'reservation-1');
    assert.equal(bridge.signal.aborted,false,'hold release must finish before aborting the run');
    released=true;return Response.json({settlement:'released'});
  });
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  assert.equal((await post('/begin',{path:'.'})).status,200);
  const response=await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  assert.equal(response.status,403);
  const reply=await response.json();
  assert.match(reply.error,new RegExp(field));
  assert.equal(reply.error,overrides.priceMicro===null
    ? 'Analysis reservation priceMicro is unavailable; the test account is not on a priced plan'
    : `Analysis reservation ${field} is missing or invalid`);
  assert.doesNotMatch(JSON.stringify(reply),/reply-value-must-stay-private|fictional-capability/);
  assert.equal(released,true);assert.equal(bridge.signal.aborted,true);
  assert.equal(budget.used,0);assert.equal(bridge.state.reservations.size,0);
});

test('priced receipt and cap debit use only priceMicro',async t=>{
  const original=globalThis.fetch;
  const budget={used:0,cap:5000000};
  const bridge=await startBridge({key:'fictional-live-key',budget,folder:resolve(fixtureDir)});
  t.after(()=>bridge.close());
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);
    if(body.action==='reserve')return Response.json(reserveReply({priceMicro:1990000,providerBudgetMicro:25000000}));
    if(body.action==='fail')return Response.json({settlement:'released'});
    return Response.json({checkId:body.checkId,projectId:body.projectId,analysisId:'analysis-1',findingIds:[],settlement:'charged'});
  });
  const post=(path,body)=>fetch(bridge.url+'/console'+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  assert.equal((await fetch(bridge.url+'/begin',{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify({path:'.'})})).status,200);
  const reserved=await post('/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  assert.equal(reserved.status,200,JSON.stringify(await reserved.json()));
  const uploaded=await post('/api/cli/checks/local',{reservationId:'reservation-1',projectId:'project-1',checkId:'check-1'});
  assert.equal(uploaded.status,200);
  assert.equal(budget.used,1990000);
  assert.deepEqual(bridge.state.receipts[0],{
    analysisId:'analysis-1',projectId:'project-1',priceMicro:1990000,chargedMicro:1990000,
  });
  assert.deepEqual(bridge.state.failures,[]);
});

for(const mode of ['refused-status','refused-settlement','refused-network','refused-timeout','refused-slow-network','refused-slow-reserve','invalid-release-network','cleanup-network','cleanup-after-failure']) {
  test('reports an unreleased hold for '+mode,async t=>{
    const args=mode.startsWith('refused-slow-')?['run','--confirm-paid','--timeout-seconds','1']:undefined;
    const r=await run(t,args,mode);
    assert.equal(r.status,1,r.stdout+r.stderr);
    for(const name of ['Claude','Codex']) {
      const row=r.stdout.split('\n').find(line=>line.startsWith('FAIL '+name));
      assert.match(row??'',/Could not release refused reservation hold/);
      if(mode==='cleanup-after-failure')assert.match(row,/Unexpected console endpoint/);
    }
    assert.ok(r.calls.some(c=>c.name==='codex'),'Codex must actually run');
    assert.equal(r.calls.filter(c=>c.name==='model-work').length,mode==='cleanup-network'?6:0);
    assert.ok(!r.stdout.includes('fictional-live-key')&&!r.stderr.includes('fictional-live-key'));
  });
}

for(const [mode,reason] of [
  ['claims-only',/did not initialize/],
  ['no-upload',/Missing matching console upload receipt/],
  ['no-summary',/Missing CLI summary or console findings URL/],
  ['tool-error',/MCP analysis did not complete successfully/],
  ['duplicate',/Only one analysis of the copied agent is allowed/],
  ['install-fails',/claude exited 2/],
  ['agent-fails',/claude exited 3/],
  ['bridge-fails',/Unexpected console endpoint/],
  ['sign-in-changed',/In-memory CLI sign-in failed/],
  ['disallowed-analyze_skipped_files',/Refused MCP tool: analyze_skipped_files/],
  ['disallowed-sign_in',/Refused MCP tool: sign_in/],
])test('fails on '+mode+' for its own reason and still runs Codex',async t=>{
  const r=await run(t,undefined,mode);assert.notEqual(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL.*Claude/);assert.match(r.stdout,/Codex/);
  assert.match(r.stdout.split('\n').find(line=>/FAIL.*Claude/.test(line)),reason);
  assert.ok(r.calls.some(c=>c.name==='codex'),'Codex must actually run');
  if(mode==='duplicate'||mode==='bridge-fails')assert.ok(r.duration<7000,'eight guard failures must finish within seven seconds');
});

test('empty PATH entries cannot select an executable from the current directory',async t=>{
  const r=await run(t,undefined,'ok','fictional-live-key',true);
  assert.equal(r.status,1);assert.match(r.stderr,/Missing executable: npx/);assert.deepEqual(r.calls,[]);
});

test('adapter replies with a JSON-RPC error for a duplicate analysis and exits with stdin open',async t=>{
  const root=mkdtempSync(join(tmpdir(),'live-adapter-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bridge=await startBridge({key:'fictional-live-key',budget:{used:0,cap:5000000},folder:root});
  t.after(()=>bridge.close());
  const npx=join(root,'npx');
  writeFileSync(npx,`#!${process.execPath}\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{content:[]}})+'\\n');});\n`,{mode:0o755});
  const child=spawn(process.execPath,[fileURLToPath(new URL('./live-agent-mcp.mjs',import.meta.url)),'-y','@counterfact-labs/cli@latest','mcp'],{
    env:{...process.env,HOME:root,LIVE_AGENT_REAL_NPX:npx,LIVE_AGENT_BRIDGE:bridge.url,LIVE_AGENT_TOKEN:bridge.token},
    stdio:['pipe','pipe','pipe'],detached:true,
  });
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{ /* Already exited. */ }};
  t.after(kill);
  let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.resume();
  const timer=setTimeout(kill,3000);
  for(const id of [2,3])child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'analyze_agent',arguments:{path:root}}})+'\n');
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  assert.equal(status,1,'adapter must exit without waiting for the caller to close stdin');
  const reply=stdout.trim().split('\n').map(line=>JSON.parse(line)).find(message=>message.id===3);
  assert.equal(reply?.jsonrpc,'2.0');assert.equal(reply?.error?.code,-32000);assert.equal(reply?.result,undefined);
});

test('bounds headless runs and removes isolated directories after timeout',async t=>{
  const r=await run(t,['run','--confirm-paid','--timeout-seconds','1'],'hang');
  assert.notEqual(r.status,0);assert.match(r.stdout,/timed out/i);
  for(const c of r.calls.filter(c=>c.home))assert.equal(existsSync(c.home),false);
});

test('each analysis also obeys the five dollar ceiling when the run still has fifteen dollars',async t=>{
  const original=globalThis.fetch;
  const budget={used:0,cap:15000000};
  const bridge=await startBridge({key:'fictional-live-key',budget,folder:resolve(fixtureDir)});
  t.after(()=>bridge.close());
  let released=false;
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);
    if(body.action==='reserve')return Response.json(reserveReply({priceMicro:5000001}));
    released=true;return Response.json({settlement:'released'});
  });
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  await post('/begin',{path:'.'});
  const response=await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/Per-analysis.*cap/);
  assert.equal(budget.used,0);assert.equal(released,true);
});

test('free probes withhold the real capability, release a reservation and never spend the run budget',async t=>{
  const original=globalThis.fetch;
  const actions=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);actions.push(body.action);
    return Response.json(body.action==='reserve'?reserveReply():{settlement:'released'});
  });
  const budget={used:0,cap:20000000};
  const bridge=await startBridge({key:'fictional-live-key',budget,folder:resolve(fixtureDir),free:true});
  t.after(()=>bridge.close());
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  // /begin prevents the old paid guard from masquerading as a free-mode guard.
  await post('/begin',{path:'.'});
  const response=await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  assert.equal(response.status,200);
  const value=await response.json();
  assert.equal(value.priceMicro,1000000);
  assert.notEqual(value.reservationToken,'fictional-capability');
  assert.equal(typeof value.reservationToken,'string');
  assert.equal(budget.used,0);
  const released=await post('/console/api/cli/relay-reservations',{action:'fail',reservationId:'reservation-1'});
  assert.equal(released.status,200);assert.equal(bridge.state.reservations.size,0);
  assert.deepEqual(actions,['reserve','fail']);
  assert.deepEqual(bridge.state.failures,[]);
});

for(const [mode,missed] of [['miss-authority','planted-authority: no finding cited system_prompt.md:6'],['miss-description','tools-agent: no finding cited tools.json:5'],['miss-code','tools-agent: no finding cited tools.ts:3']])test('suite catches '+mode+' in both backends while completing the matrix',async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  for(const name of ['Claude','Codex'])assert.ok(r.stdout.includes('FAIL '+name+' | '+missed.split(':')[0]),r.stdout);
  assert.ok(r.stdout.includes(missed),r.stdout);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
});
test('all eight cases produce rows and the job summary; free startup uses the plugin pin under the CLI package name',async t=>{
  const r=await run(t);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stdout.split('\n').filter(line=>/^PASS (Claude|Codex) \| (clean|planted-authority|planted-credential|tools-agent) \|/.test(line)).length,8,r.stdout);
  const starts=r.calls.filter(c=>c.name==='npx'&&c.cwd.endsWith('package-shadow'));
  assert.deepEqual(starts.map(c=>c.args),[['-y','@counterfact-labs/cli@9.8.7','mcp'],['-y','@counterfact-labs/cli@9.8.7','--help'],['-y','@counterfact-labs/cli@9.8.7','analyze','--help'],['-y','@counterfact-labs/cli@latest','mcp'],['-y','@counterfact-labs/cli@latest','--help'],['-y','@counterfact-labs/cli@latest','analyze','--help']]);
  const summary=readFileSync(join(r.root,'summary.md'),'utf8');
  assert.match(summary,/\| Agent \| Case \| Result \| Reason \|/);
  assert.equal(summary.split('\n').filter(line=>/^\| (Claude|Codex) \| (clean|planted-authority|planted-credential|tools-agent) \|/.test(line)).length,8);
  assert.match(r.stdout,/SKIP: --max-dollars not yet available/);
});
for(const mode of ['coverage-missing','coverage-present'])test('suite '+mode+' follows the tested CLI capability',async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,mode==='coverage-missing'?1:0,r.stdout+r.stderr);
  assert.match(r.stdout,mode==='coverage-missing'?/clean: CLI reports coverage support/:/coverage present/);
});
test('sign-in free probe fails a signed-out integration without attempting sign in',async t=>{
  const r=await run(t,undefined,'signed-out');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| sign-in/);
  assert.match(r.stdout,/FAIL Codex \| sign-in/);
});
test('the local run cap cannot exceed fifteen dollars',async t=>{
  const r=await run(t,['check','--max-dollars','15.000001']);
  assert.equal(r.status,1);assert.match(r.stderr,/15/);assert.deepEqual(r.calls,[]);
});
test('the local run cap accepts exactly fifteen dollars without launching tools',async t=>{
  const r=await run(t,['check','--max-dollars','15']);
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/estimate cap: \$15\.00/);assert.deepEqual(r.calls,[]);
});
test('an upload receipt cannot turn rejected planted findings into passing evidence',async t=>{
  const r=await run(t,undefined,'dropped-findings');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| planted-authority/);
  assert.match(r.stdout,/Invalid console upload receipt/);
});
for(const mode of ['cap-supported','cap-unsafe'])test('free '+mode+' runs a real terminal cap probe through the protected bridge',async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,mode==='cap-supported'?0:1,r.stdout+r.stderr);
  assert.match(r.stdout,new RegExp((mode==='cap-supported'?'PASS':'FAIL')+' Claude \\| over-cap refusal'));
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  const holds=r.calls.filter(c=>c.name==='cap-reservation');
  assert.equal(holds.length,2);
  assert.ok(holds.every(c=>typeof c.token==='string'&&c.token!=='fictional-capability'));
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.action==='fail').length,2);
});
test('failed planted assertions retain the paid receipt, cost and saved findings URL',async t=>{
  const r=await run(t,undefined,'miss-authority');
  const line=r.stdout.split('\n').find(line=>line.startsWith('FAIL Claude | planted-authority'));
  assert.match(line??'',/estimate \$1\.00; charged \(equals estimate\) \$1\.00/);
  const summary=readFileSync(join(r.root,'summary.md'),'utf8');
  assert.match(summary,/\| Claude \| planted-authority \| FAIL \|.*https:\/\/app.counterfactlabs.com\/projects\/project-1\/findings/);
});
test('one case cannot obtain a second reservation after uploading its first result',async t=>{
  const original=globalThis.fetch;let reserves=0;
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);
    if(body.action==='reserve'){reserves++;return Response.json(reserveReply());}
    return Response.json({checkId:'check-1',projectId:'project-1',analysisId:'analysis-1',findingIds:[],settlement:'charged'});
  });
  const bridge=await startBridge({key:'fictional-live-key',budget:{used:0,cap:20000000},folder:resolve(fixtureDir)});
  t.after(()=>bridge.close());
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  await post('/begin',{path:'.'});
  await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  await post('/console/api/cli/checks/local',{reservationId:'reservation-1',projectId:'project-1',checkId:'check-1',findings:[]});
  const response=await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'});
  assert.equal(response.status,502);assert.equal(reserves,1);
});

test('a free-probe configuration failure records a row without skipping any paid cases',async t=>{
  const r=await run(t,undefined,'plugin-config-changed');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| free probes \| Installed plugin MCP configuration unavailable/);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  assert.equal(r.stdout.split('\n').filter(line=>/^PASS (Claude|Codex) \| (clean|planted-authority|planted-credential|tools-agent) \|/.test(line)).length,8);
});
test('free sign-in failures report bridge refusals and keep paid cases running',async t=>{
  const r=await run(t,undefined,'free-bridge-refusal');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| sign-in \| .*Free probe attempted a paid operation/);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
});
test('free bridge blocks uploads and additional holds and releases abandoned holds',async t=>{
  const original=globalThis.fetch,actions=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);actions.push(body.action);
    return Response.json(body.action==='reserve'?reserveReply():{settlement:'released'});
  });
  const bridge=await startBridge({key:'fictional-live-key',budget:{used:0,cap:20000000},folder:resolve(fixtureDir),free:true});
  t.after(()=>bridge.close());
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  assert.equal((await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-1'})).status,200);
  assert.equal((await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:'reservation-2'})).status,502);
  assert.equal((await post('/console/api/cli/checks/local',{reservationId:'reservation-1',findings:[]})).status,502);
  await bridge.close();
  assert.deepEqual(actions,['reserve','fail']);
});

for(const mode of ['low-balance','invalid-price'])test('free bridge permits a harmless release after '+mode,async t=>{
  const original=globalThis.fetch,actions=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);actions.push(body.action);
    if(body.action==='reserve')return mode==='low-balance'
      ?Response.json({error:'Insufficient balance'},{status:402})
      :Response.json(reserveReply({priceMicro:null}));
    return Response.json({settlement:'unheld'});
  });
  const budget={used:0,cap:20000000};
  const bridge=await startBridge({key:'fictional-live-key',budget,folder:resolve(fixtureDir),free:true});
  t.after(()=>bridge.close());
  const post=body=>fetch(bridge.url+'/console/api/cli/relay-reservations',{
    method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  assert.equal((await post({action:'reserve',reservationId:'reservation-1'})).status,mode==='low-balance'?402:403);
  const released=await post({action:'fail',reservationId:'reservation-1'});
  assert.equal(released.status,200);
  assert.equal((await released.json()).settlement,'unheld');
  assert.equal(bridge.state.reservations.size,0);assert.equal(budget.used,0);
  assert.deepEqual(actions,mode==='low-balance'?['reserve','fail']:['reserve','fail','fail']);
  assert.deepEqual(bridge.state.failures,mode==='low-balance'?[]:
    ['Analysis reservation priceMicro is unavailable; the test account is not on a priced plan']);
});

test('real intake-shaped findings preserve primary and secondary citations with repeated saved IDs',async t=>{
  const original=globalThis.fetch;
  const payload=uploadPayload([
    uploadFinding('system_prompt.md',6),
    uploadFinding('system_prompt.md',6),
    uploadFinding('tools.json',5,[{repo:'local:fictional-warehouse',path:'tools.ts',line:3,excerpt:'Fictional source evidence'}]),
  ]);
  const ids=['saved-authority','saved-authority','saved-tools'];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(!String(input).startsWith('https://app.counterfactlabs.com/'))return original(input,options);
    const body=JSON.parse(options.body);
    return Response.json(body.action==='reserve'?reserveReply({reservationId:payload.reservationId,projectId:payload.projectId}):{
      checkId:payload.checkId,projectId:payload.projectId,analysisId:'analysis-1',findingIds:ids,settlement:'charged'});
  });
  const bridge=await startBridge({key:'fictional-live-key',budget:{used:0,cap:20000000},folder:resolve(fixtureDir)});
  t.after(()=>bridge.close());
  const post=(path,body)=>fetch(bridge.url+path,{method:'POST',headers:{'x-live-agent-token':bridge.token},body:JSON.stringify(body)});
  await post('/begin',{path:'.'});
  await post('/console/api/cli/relay-reservations',{action:'reserve',reservationId:payload.reservationId});
  const receipt=await post('/console/api/cli/checks/local',payload);
  assert.equal(receipt.status,200);
  const {assertCase}=await import('./live-agent-cases.mjs');
  assert.match(assertCase('planted-authority',{findings:bridge.state.findings}).reason,/cited/);
  assert.match(assertCase('tools-agent',{findings:bridge.state.findings}).reason,/cited/);
});


test('successful uploads match MCP replies that omit optional analysis and project IDs',async t=>{
  const r=await run(t,undefined,'optional-mcp-ids');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stdout.match(/charged \(equals estimate\) \$1\.00/g)?.length,6);
});
test('Claude free startup forwards the installed plugin prefix and exact pin',async t=>{
  const r=await run(t,undefined,'plugin-prefix');
  assert.equal(r.status,0,r.stdout+r.stderr);
  const startup=r.calls.find(c=>c.name==='npx'&&c.cwd.endsWith('package-shadow'));
  assert.deepEqual(startup?.args,['-y','--prefix='+join(startup.home,'.claude/plugins/cache/counterfact-labs/counterfact/9.8.7'),'@counterfact-labs/cli@9.8.7','mcp']);
  assert.match(r.stdout,/PASS Claude \| MCP package startup/);
});
test('credential proposal and discovery refusals before reservation pass in both agents',async t=>{
  const r=await run(t,undefined,'credential-refusal');
  assert.equal(r.status,0,r.stdout+r.stderr);
  for(const backend of ['Claude','Codex'])assert.match(r.stdout,new RegExp('PASS '+backend+' \\| planted-credential \\| Credential-containing prompt refused before reservation; charged \\$0.00'));
  const summary=readFileSync(join(r.root,'summary.md'),'utf8');
  for(const output of [r.stdout,summary])assert.equal(output.match(/credential message not yet available/g)?.length,2,output);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.action==='reserve').length,6);
});
test('credential new message names the skipped prompt for both proposal and discovery without reserving',async t=>{
  const r=await run(t,undefined,'credential-new-message');
  assert.equal(r.status,0,r.stdout+r.stderr);
  for(const backend of ['Claude','Codex'])assert.match(r.stdout,new RegExp('PASS '+backend+' \\| planted-credential \\| Credential-containing prompt refused before reservation; charged \\$0.00'));
  for(const output of [r.stdout,readFileSync(join(r.root,'summary.md'),'utf8')])assert.doesNotMatch(output,/credential message not yet available/);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.action==='reserve').length,6);
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.path==='/api/cli/checks/local').length,6);
});
for(const mode of ['credential-new-wrong-file','credential-new-wrong-kind','credential-new-candidates','credential-new-paid-refusal','credential-new-invalid-proposal'])test('credential new message rejects '+mode,async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| planted-credential/);
  assert.match(r.stdout,new RegExp((mode==='credential-new-invalid-proposal'?'PASS':'FAIL')+' Codex \\| planted-credential'));
});
test('credential refusal passes with a paraphrased final agent response',async t=>{
  const r=await run(t,undefined,'credential-paraphrase');
  assert.equal(r.status,0,r.stdout+r.stderr);
  for(const backend of ['Claude','Codex'])assert.match(r.stdout,new RegExp('PASS '+backend+' \\| planted-credential'));
});
test('credential refusal accepts the expected prompt with a relative dot prefix',async t=>{
  const r=await run(t,undefined,'credential-relative-proposal');
  assert.equal(r.status,0,r.stdout+r.stderr);
});
for(const mode of ['credential-invalid-proposal','credential-unrelated-proposal'])test('credential refusal rejects '+mode,async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/FAIL Claude \| planted-credential \| planted-credential: MCP analysis did not complete successfully/);
  assert.match(r.stdout,/PASS Codex \| planted-credential/);
});
test('credential case fails when the file is admitted, uploaded and cited',async t=>{
  const r=await run(t,undefined,'credential-admitted');
  assert.equal(r.status,1,r.stdout+r.stderr);
  for(const backend of ['Claude','Codex'])assert.match(r.stdout,new RegExp('FAIL '+backend+' \\| planted-credential \\| planted-credential: expected refusal before reservation'));
});
for(const mode of ['credential-no-agent-with-proposal','credential-proposal-without-proposal','credential-failed-turn','credential-no-tool-event'])test('credential refusal rejects '+mode,async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  const backend=['credential-proposal-without-proposal','credential-no-tool-event'].includes(mode)?'Codex':'Claude';
  assert.match(r.stdout,new RegExp('FAIL '+backend+' \\| planted-credential'));
});
for(const mode of ['credential-paid-refusal','credential-wrong-refusal','no-agent-clean'])test('rejects '+mode,async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,new RegExp('FAIL Claude \\| '+(mode==='no-agent-clean'?'clean':'planted-credential')));
});
for(const mode of ['mismatched-analysis','mismatched-project','no-summary','tool-error'])test(mode+' still fails and retains independently verified receipt costs and URL',async t=>{
  const r=await run(t,undefined,mode);
  assert.equal(r.status,1,r.stdout+r.stderr);
  const row=r.stdout.split('\n').find(line=>line.startsWith('FAIL Claude | clean'));
  const reason=mode.startsWith('mismatched-')?'Missing matching console upload receipt':mode==='no-summary'?'Missing CLI summary or console findings URL':'MCP analysis did not complete successfully';
  assert.match(row??'',new RegExp('^FAIL Claude \\| clean \\| clean: '+reason+'; estimate \\$1\\.00; charged \\(equals estimate\\) \\$1\\.00; provider not reported; [0-9]+\\.[0-9]s$'));
  const summary=readFileSync(join(r.root,'summary.md'),'utf8');
  assert.match(summary,/\| Claude \| clean \| FAIL \|.*https:\/\/app.counterfactlabs.com\/projects\/project-1\/findings/);
});
test('published CLI reply shapes, installed prefix and npm block work together',async t=>{
  const r=await run(t,undefined,'cli-029');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,6);
  assert.equal(r.stdout.split('\n').filter(line=>/^PASS (Claude|Codex) \| (clean|planted-authority|planted-credential|tools-agent) \|/.test(line)).length,8);
});
