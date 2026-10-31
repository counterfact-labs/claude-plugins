import assert from 'node:assert/strict';
import test from 'node:test';
const probes = await import('./live-agent-probes.mjs').catch(() => ({}));
const run = async (args, help = 'Usage: analyze --max-dollars', refusal = { code: 1, stdout: "This analysis costs more than the limit you set, so it didn't start. Nothing was charged.", stderr: '' }) => args.includes('--help') ? { code: 0, stdout: help, stderr: '' } : refusal;
async function cap(options = {}) {
  assert.equal(typeof probes.overCapProbe, 'function', 'free cap probe must exist');
  return probes.overCapProbe({ run: args => run(args), safe: () => true, ...options });
}
test('over-cap probe skips with a reason only when this CLI help lacks the flag', async () => {
  assert.deepEqual(await cap({ run: args => run(args, 'Usage: analyze') }), { pass: true, reason: 'SKIP: --max-dollars not yet available in this CLI' });
});
test('over-cap probe requires the real terminal refusal, exit 1, and a safely released reservation', async () => {
  assert.equal((await cap()).pass, true);
  for (const reply of [{ code: 0, stdout: 'Analysis completed' }, { code: 2, stdout: "This analysis costs more than the limit you set, so it didn't start. Nothing was charged." }, { code: 1, stdout: 'Network error' }, { code: 1, stdout: 'unknown option --max-dollars' }]) {
    assert.equal((await cap({ run: args => run(args, undefined, reply) })).pass, false);
  }
  assert.equal((await cap({ safe: () => false })).pass, false);
});
test('public links follow redirects, report setup 404 as not yet live, and fail other broken links', async () => {
  assert.equal(typeof probes.checkLinks, 'function', 'public link probe must exist');
  const calls = [];
  const fetcher = async url => { calls.push(url); return { status: url.endsWith('/setup') ? 404 : 200, url }; };
  const rows = await probes.checkLinks('[Docs](https://docs.example.com/a) and [home](https://counterfactlabs.com)', fetcher);
  assert.deepEqual(calls, ['https://counterfactlabs.com/setup', 'https://docs.example.com/a', 'https://counterfactlabs.com']);
  assert.ok(rows.every(r => r.pass));
  assert.match(rows[0].reason, /not yet live/);
  for (const status of [403, 500]) {
    const rows = await probes.checkLinks('[Docs](https://docs.example.com/a)', async url => ({ status, url }));
    assert.ok(rows.every(r => !r.pass));
  }
  const failed = await probes.checkLinks('[Docs](https://docs.example.com/a)', async () => { throw Error('network private details'); });
  assert.ok(failed.every(r => !r.pass));
  assert.doesNotMatch(JSON.stringify(failed), /private details/);
});
test('older CLI global help can report lack of cap even when analyze help is unsupported', async () => {
  const r = await cap({ run: async args => args[0] === '--help' ? { code: 0, stdout: 'Usage: analyze [path]', stderr: '' } : { code: 1, stdout: '', stderr: 'Unknown option --help' } });
  assert.equal(r.pass, true); assert.match(r.reason, /not yet available/);
});


const otherUrls=[
  'https://www.npmjs.com.example.com/package/@counterfact-labs/cli',
  'https://notnpmjs.com/package/@counterfact-labs/cli',
  'https://docs.example.com/npmjs.com',
  'https://docs.example.com/?next=https://www.npmjs.com',
  'https://www.npmjs.com@docs.example.com/package/@counterfact-labs/cli',
];

test('npm package page HTTP 403 is explicitly not checkable, while other errors still fail',async()=>{
  const url='https://www.npmjs.com/package/@counterfact-labs/cli';
  const readme='[CLI]('+url+') '+otherUrls.map(other=>'[Other]('+other+')').join(' ');
  const rows=await probes.checkLinks(readme,async requested=>({status:new URL(requested).hostname==='www.npmjs.com'?403:200,url:requested}));
  assert.deepEqual(rows.find(r=>r.case===url),{backend:'free',case:url,pass:true,reason:'SKIP: npm package page not checkable (HTTP 403; external access block)'});
  for(const otherUrl of otherUrls) {
    assert.deepEqual(rows.find(r=>r.case===otherUrl),{backend:'free',case:otherUrl,pass:true,reason:'HTTP 200'});
  }
  for(const status of [404,500]) {
    const rows=await probes.checkLinks('[CLI]('+url+')',async url=>({status,url}));
    assert.equal(rows.find(r=>r.case===url).pass,false);
  }
  const rows2=await probes.checkLinks('[Other](https://docs.example.com/a)',async url=>({status:403,url}));
  assert.ok(rows2.every(r=>!r.pass));
});

test('HTTP 403 skips only the exact npm package URL and fails every lookalike',async()=>{
  const url='https://www.npmjs.com/package/@counterfact-labs/cli';
  const readme='[CLI]('+url+') '+otherUrls.map(other=>'[Other]('+other+')').join(' ');
  const rows=await probes.checkLinks(readme,async requested=>({status:403,url:requested}));
  assert.deepEqual(rows,[
    {backend:'free',case:'https://counterfactlabs.com/setup',pass:false,reason:'HTTP 403'},
    {backend:'free',case:url,pass:true,reason:'SKIP: npm package page not checkable (HTTP 403; external access block)'},
    ...otherUrls.map(other=>({backend:'free',case:other,pass:false,reason:'HTTP 403'})),
  ]);
});
