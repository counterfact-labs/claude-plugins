import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startBridge } from './live-agent-bridge.mjs';

const script = fileURLToPath(new URL('./live-agent-check.sh', import.meta.url));
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
const log = value => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(value) + '\\n');
log({name, args, home: process.env.HOME, cwd: process.cwd(), keyPresent: !!process.env.COUNTERFACT_LIVE_TEST_KEY,
  prompt: fs.existsSync('system_prompt.md') ? fs.readFileSync('system_prompt.md', 'utf8') : null,
  codexHome: process.env.CODEX_HOME, claudeHome: process.env.CLAUDE_CONFIG_DIR, npmCache: process.env.npm_config_cache});
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
if (name === 'npx') {
  const pending = new Map();
  createInterface({input:process.stdin}).on('line', async line => {
    const q = JSON.parse(line);
    if (!q.id) return;
    if (q.method === 'initialize') {
      send({jsonrpc:'2.0',id:q.id,result:{serverInfo:{name:'counterfact-labs',version:args[1].split('@').at(-1)}}});
    } else if (q.method === 'tools/list') {
      send({jsonrpc:'2.0',id:q.id,result:{tools:[{name:'analyze_agent',inputSchema:{type:'object'}}]}});
    } else if (q.method === 'tools/call') {
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
        if (mode === 'bridge-fails') await call('/api/cli/unexpected',{});
        const created = await call('/api/cli/relay-reservations',{action:'create'});
        const reserved = await call('/api/cli/relay-reservations',{action:'reserve',reservationId:created.reservationId});
        if (mode === 'cleanup-after-failure') await call('/api/cli/unexpected',{});
        log({name:'model-work',backend:process.env.LIVE_AGENT_BACKEND});
        if (!['no-upload','cleanup-network'].includes(mode)) await call('/api/cli/checks/local',{
          reservationId:created.reservationId,checkId:created.checkId,projectId:created.projectId,findings:[]});
        const text = mode === 'no-summary' ? '' : 'No findings.\\nFull results: https://app.counterfactlabs.com/projects/project-1/findings\\n';
        send({jsonrpc:'2.0',id:q.id,result:{content:[{type:'text',text}],isError:mode==='tool-error',
          structuredContent:{text,exitCode:0,url:'https://app.counterfactlabs.com/projects/project-1/findings',analysisId:'analysis-1',projectId:'project-1',findings:[]}}});
      } catch { send({jsonrpc:'2.0',id:q.id,result:{isError:true,content:[{type:'text',text:'Analysis refused'}],structuredContent:{exitCode:1,text:'Analysis refused'}}}); }
    }
  });
} else if (name === 'claude' && args[0] === 'plugin') {
  if (mode === 'install-fails') process.exit(2);
  if (args[1] === 'install') {
    const p=path.join(process.env.HOME,'.claude/plugins/cache/counterfact-labs/counterfact/9.8.7');
    fs.mkdirSync(p,{recursive:true});
    fs.writeFileSync(path.join(p,'.mcp.json'),JSON.stringify({mcpServers:{counterfact:{command:'npx',args:['-y','@counterfact-labs/cli@9.8.7','mcp']}}}));
    fs.writeFileSync(path.join(process.env.HOME,'.claude/plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'counterfact@counterfact-labs':[{installPath:p,version:'9.8.7',scope:'user'}]}}));
  }
} else {
  if (mode === 'hang') { setInterval(()=>{},1000); return; }
  if (mode === 'agent-fails' && name === 'claude') process.exit(3);
  const done = () => {
    if (name === 'claude') send({type:'result',subtype:'success',is_error:false,result:'No findings. https://app.counterfactlabs.com/projects/project-1/findings',total_cost_usd:0.04});
    else {send({type:'item.completed',item:{type:'agent_message',text:'No findings. https://app.counterfactlabs.com/projects/project-1/findings'}});send({type:'turn.completed',usage:{input_tokens:12,output_tokens:4}});}
  };
  if (mode === 'claims-only') {done();return;}
  if (name === 'claude') send({type:'system',subtype:'init',mcp_servers:[{name:'plugin:counterfact:counterfact',status:'connected'}],plugins:[{name:'counterfact'}]});
  const pin=name==='claude'?'@counterfact-labs/cli@9.8.7':'@counterfact-labs/cli@latest';
  if (name === 'codex') {
    const config=fs.readFileSync(path.join(process.env.CODEX_HOME,'config.toml'),'utf8');
    log({name:'codex-config',text:config});
    if (!config.includes(pin) || !config.includes('tool_timeout_sec = 900')) process.exit(7);
  }
  const child=spawn('npx',['-y',pin,'mcp'],{stdio:['pipe','pipe','inherit']});
  child.on('error',()=>process.exit(8));
  const write = q=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',...q})+'\\n');
  createInterface({input:child.stdout}).on('line',line=>{
    const r=JSON.parse(line);
    if (r.id===1) {write({method:'notifications/initialized'});write({id:2,method:'tools/call',params:{name:mode.startsWith('disallowed-')?mode.slice('disallowed-'.length):'analyze_agent',arguments:{path:process.cwd()}}});}
    else if (r.id===2) {
      if (mode==='bridge-fails') {setInterval(()=>{},1000);return;}
      if (mode==='duplicate') {write({id:3,method:'tools/call',params:{name:'analyze_agent',arguments:{path:process.cwd()}}});return;}
      if(name==='codex')send({type:'item.completed',item:{type:'mcp_tool_call',server:'counterfact',tool:'analyze_agent',status:'completed',result:r.result}});
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
  if (!url.startsWith('https://app.counterfactlabs.com/')) return original(input,options);
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
      priceMicro:['unpriced-plan','unknown-price','invalid-release-network'].includes(mode)?null:mode==='free-personal'?0:mode==='priced-personal'?1990000:mode==='over-cap'||mode.startsWith('refused-')?6000000:mode==='total-cap'?3000000:1000000,
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
  else if(url.endsWith('/checks/local'))result={checkId:body.checkId,projectId:body.projectId,analysisId:'analysis-1',findingIds:[],settlement:'charged'};
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
    NODE_OPTIONS:'--import='+loader,COUNTERFACT_LIVE_TEST_KEY:key,TMPDIR:root,
    CODEX_HOME:join(root,'original-codex'),CLAUDE_CONFIG_DIR:join(root,'original-claude'),
    CF_CONSOLE_URL:'https://do-not-use.invalid',COUNTERFACT_URL:'https://do-not-use.invalid',
    ANTHROPIC_API_KEY:'fictional-provider-key',CODEX_API_KEY:'fictional-provider-key'};
  const started=Date.now();
  const child=spawn('bash',[script,...args,...(agentDir ? ['--agent-dir',agentDir] : [])],{env,cwd:root,detached:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{ /* Already exited. */ }};
  t.after(kill);
  const timer=setTimeout(kill,mode==='duplicate'||mode==='bridge-fails'?4000:15000);
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
  const calls=readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  return {status,stdout,stderr,calls,root,duration:Date.now()-started};
}

test('check without an agent directory preserves the existing local default',async t=>{
  const r=await run(t,['check'],'ok','',false,null);
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(r.calls,[]);
  assert.match(r.stdout,/Copy \S*scripts\/fixtures\/live-agent separately/);
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
  assert.equal(agents.length,2);
  for(const agent of agents)assert.equal(agent.prompt,prompt);
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
  const agents=r.calls.filter(c=>c.name==='claude'&&c.args.includes('-p')||c.name==='codex');assert.equal(agents.length,2);
  assert.notEqual(agents[0].home,agents[1].home);
  for(const a of agents){assert.equal(a.keyPresent,false);assert.ok(a.cwd.startsWith(a.home.slice(0,a.home.lastIndexOf('/'))));assert.equal(existsSync(a.home),false);assert.equal(existsSync(a.cwd),false);}
  assert.deepEqual(r.calls.filter(c=>c.name==='npx').map(c=>c.args),[['-y','@counterfact-labs/cli@9.8.7','mcp'],['-y','@counterfact-labs/cli@latest','mcp']]);
  assert.equal(readFileSync(fixtureSource,'utf8'),before);
  assert.ok(!r.stdout.includes('fictional-live-key')&&!r.stderr.includes('fictional-live-key'));
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,2);
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
  assert.equal(r.calls.filter(c=>c.name==='console'&&c.action==='fail').length,2);
  assert.doesNotMatch(r.stdout+r.stderr,/fictional-live-key|fictional-capability/);
});

test('two Personal prices fit the shared five dollar cap regardless of provider budgets',async t=>{
  const r=await run(t,undefined,'priced-personal');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/total Counterfact cap \$5\.00/);
  assert.equal(r.stdout.match(/estimate \$1\.99; charged \(equals estimate\) \$1\.99/g)?.length,2);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,2);
  assert.doesNotMatch(r.stdout,/workspace allowance|provider budget/);
});

test('free Personal reservations count their zero price rather than the provider budget',async t=>{
  const r=await run(t,['run','--confirm-paid','--max-dollars','0.000001'],'free-personal');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.stdout.match(/estimate \$0\.00; charged \(equals estimate\) \$0\.00/g)?.length,2);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,2);
});

for(const mode of ['over-cap','unknown-price','total-cap'])test('withholds model work and releases the hold for '+mode,async t=>{
  const r=await run(t,undefined,mode);assert.notEqual(r.status,0,r.stdout);assert.match(r.stdout,/FAIL/);
  assert.match(r.stdout,mode==='unknown-price'?/Analysis reservation priceMicro is unavailable; the test account is not on a priced plan/
    :/Total analysis priceMicro exceeds the cap/);
  assert.equal(r.calls.filter(c=>c.name==='model-work').length,mode.endsWith('total-cap')?1:0);
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
    assert.equal(r.calls.filter(c=>c.name==='model-work').length,mode==='cleanup-network'?2:0);
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
  if(mode==='duplicate'||mode==='bridge-fails')assert.ok(r.duration<3000,'guard failure must finish within three seconds');
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
  for(const c of r.calls)assert.equal(existsSync(c.home),false);
});
