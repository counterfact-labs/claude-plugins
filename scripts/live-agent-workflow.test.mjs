import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflowPath = new URL('../.github/workflows/live-agent-check.yml', import.meta.url);
const secretNames = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COUNTERFACT_LIVE_TEST_KEY'];

function workflow(env = process.env) {
  assert.ok(existsSync(workflowPath), 'the live release analysis workflow must exist');
  // BaseLoader preserves GitHub's on key instead of treating it as YAML 1.1 true.
  const parsed = spawnSync('python3', ['-c',
    'import json,sys\ntry:\n import yaml\nexcept ImportError:\n sys.exit("Workflow tests require Python 3 with PyYAML (python3 -m pip install PyYAML).")\njson.dump(yaml.load(sys.stdin, Loader=yaml.BaseLoader), sys.stdout)'], {
    input: readFileSync(workflowPath, 'utf8'), env, encoding: 'utf8', timeout: 5000,
  });
  assert.ok(!parsed.error, 'Workflow tests require Python 3 with PyYAML: ' + parsed.error?.message);
  assert.equal(parsed.status, 0, parsed.stderr);
  return JSON.parse(parsed.stdout);
}

function temporary(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function shell(program, env) {
  return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', program], {
    env: { PATH: process.env.PATH, GITHUB_JOB: 'poll', ...env }, encoding: 'utf8', timeout: 5000,
  });
}

function schedules(config) {
  return {
    hourly: config.on.schedule.find(entry => entry.cron.split(' ').slice(1).every(part => part === '*'))?.cron,
    nightly: config.on.schedule.find(entry => entry.cron === '23 11 * * *')?.cron,
  };
}

function allSteps(config = workflow()) {
  return Object.values(config.jobs).flatMap(job => job.steps);
}

test('live analysis responds to releases, manual requests, nightly runs and hourly npm polling', () => {
  const config = workflow();
  assert.deepEqual(Object.keys(config.on).sort(), ['release', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(config.on.release.types, ['published']);
  assert.equal(config.on.schedule.length, 3);
  const { hourly, nightly } = schedules(config);
  assert.ok(hourly, 'poll npm every hour');
  assert.ok(nightly, 'retain an unconditional nightly analysis');
  assert.ok(Number(hourly.split(' ')[0]) < 60);
  assert.deepEqual(nightly.split(' ').slice(2), ['*', '*', '*']);
});

test('live analysis scopes secrets, pins dependencies and bounds each paid run', () => {
  const config = workflow();
  assert.deepEqual(config.permissions, { contents: 'read' });
  for (const job of Object.values(config.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(Number(job['timeout-minutes']) <= 210);
    for (const name of secretNames) assert.equal(job.env?.[name], undefined);
  }
  const steps = allSteps(config);
  const gate = steps.find(step => step.id === 'credentials');
  assert.equal(steps[0], gate, 'skip before installing dependencies');
  assert.deepEqual(gate.env, Object.fromEntries(secretNames.map(name => [name, '${{ secrets.' + name + ' }}'])));
  for (const step of steps.slice(1)) {
    if (step.uses) assert.match(step.uses, /^actions\/[a-z/-]+@[a-f0-9]{40}$/);
    assert.doesNotMatch(step.run ?? '', /\b(?:set\s+-x|printenv|env\s*$)/m);
    if (step.name !== 'Run live agent analysis') {
      for (const name of secretNames) assert.equal(step.env?.[name], undefined);
    }
  }
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], 'false');
  const install = steps.find(step => /npm install/.test(step.run ?? ''));
  assert.match(install.run, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+(?:\s|$)/);
  assert.match(install.run, /@openai\/codex@\d+\.\d+\.\d+(?:\s|$)/);
  const live = steps.find(step => step.name === 'Run live agent analysis');
  assert.match(live.run, /scripts\/live-agent-check\.sh run --confirm-paid --max-dollars 15(?:\s|$)/);
  const seconds = Number(live.run.match(/--timeout-seconds (\d+)/)?.[1]);
  const job = Object.values(config.jobs).find(job => job.steps.includes(live));
  assert.ok(seconds > 0 && seconds * 10 + 16 * 60 + 6 * 60 < Number(live['timeout-minutes']) * 60,
    'eight analyses, two plugin commands, free probes and hold cleanup fit inside the paid step');
  assert.ok(Number(live['timeout-minutes']) + 15 < Number(job['timeout-minutes']), 'job leaves time for installing agents and saving attempts');
  assert.deepEqual(live.env, gate.env);
});

test('secret gate warns for each absent or blank credential without logging values', (t) => {
  const gate = allSteps().find(step => step.id === 'credentials');
  const root = temporary(t, 'live-workflow-');
  for (const absent of [secretNames, ...secretNames.map(name => [name]), []]) {
    for (const blank of ['', ' \t\n']) {
      const output = join(root, 'output');
      writeFileSync(output, '');
      const env = { GITHUB_OUTPUT: output, GITHUB_ENV: join(root, 'env'), RUNNER_TEMP: root };
      for (const name of secretNames) env[name] = absent.includes(name) ? blank : 'fictional-' + name + '-value';
      const result = shell(gate.run, env);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), 'ready=' + (absent.length ? 'false' : 'true') + '\n');
      if (absent.length) {
        assert.match(result.stdout, /^::warning::Skipping live agent analysis.*missing/im);
        for (const name of absent) assert.ok(result.stdout.includes(name));
      } else assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stdout + result.stderr, /fictional-.*-value/);
    }
  }
});

test('workflow runs all cases and keeps the original clean fixture without privileged preparation', () => {
  const steps = allSteps();
  const live = steps.find(step => step.name === 'Run live agent analysis');
  assert.doesNotMatch(live.run, /--agent-dir "\$GITHUB_WORKSPACE\/scripts\/fixtures\/live-agent"/);
  assert.ok(steps.every(step => !/sudo|counterfact-local|<<'NODE'/.test(step.run ?? '')));
  const fixture = new URL('./fixtures/live-agent/', import.meta.url);
  assert.deepEqual(readdirSync(fixture), ['system_prompt.md']);
  const prompt = readFileSync(new URL('system_prompt.md', fixture), 'utf8');
  assert.ok(prompt.trim().length > 0 && prompt.length < 1500);
  assert.doesNotMatch(prompt, /Bramblewood|sourceCommit|expected.*(?:answer|fail)|evals/i);
  const result = spawnSync('bash', ['scripts/live-agent-check.sh', 'check', '--agent-dir', fixture.pathname], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scripts\/fixtures\/live-agent/);
});

test('npm polling runs for changed versions; release, nightly and manual analyses always run', (t) => {
  const config = workflow();
  const poll = allSteps(config).find(step => step.id === 'cli');
  assert.ok(poll, 'the npm version gate must exist');
  const { hourly, nightly } = schedules(config);
  assert.equal(poll.env.EVENT_SCHEDULE, '${{ github.event.schedule }}');
  const root = temporary(t, 'live-workflow-version-');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/bash\n[[ "$*" == "view @counterfact-labs/cli version" ]] || exit 9\nprintf "%s\\n" "$FAKE_VERSION"\nexit "${FAKE_STATUS:-0}"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/bin/bash\nprintf '{"ok":true,"revision":"deploy-1"}\\n'\n`, {mode:0o755});
  writeFileSync(join(bin, 'date'), `#!/bin/bash\nprintf '%s\\n' '-0800'\n`, {mode:0o755});
  const revision = join(root, 'revision'); writeFileSync(revision, 'deploy-1\n');
  const state = join(root, 'last-version');
  const output = join(root, 'output');
  for (const [event, schedule, previous, latest, want] of [
    ['schedule', hourly, null, '0.2.9', true],
    ['schedule', hourly, '0.2.9', '0.2.9', false],
    ['schedule', '42 * * * *', '0.2.9', '0.2.9', false],
    ['schedule', hourly, '0.2.9', '0.2.10', true],
    ['schedule', hourly, '0.2.10', '0.2.9', true],
    ['schedule', hourly, 'corrupt', '0.2.9', true],
    ['schedule', nightly, '0.2.9', '0.2.9', true],
    ['workflow_dispatch', '', '0.2.9', '0.2.9', true],
    ['release', '', '0.2.9', '0.2.9', true],
  ]) {
    rmSync(state, { force: true });
    if (previous !== null) writeFileSync(state, previous + '\n');
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: bin + ':' + process.env.PATH, FAKE_VERSION: latest,
      GITHUB_EVENT_NAME: event, EVENT_SCHEDULE: schedule,
      LIVE_AGENT_VERSION_FILE: state, LIVE_AGENT_REVISION_FILE: revision, GITHUB_OUTPUT: output,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=' + latest + '\nrevision=deploy-1\nrun=' + want + '\n');
    assert.equal(existsSync(state), previous !== null, 'polling must not record an analysis as successful');
    if (previous !== null) assert.equal(readFileSync(state, 'utf8'), previous + '\n');
  }
  for (const [latest, status] of [['', '0'], ['not-a-version', '0'], ['0.2.9\nrun=false', '0'], ['0.2.9', '1']]) {
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: bin + ':' + process.env.PATH, FAKE_VERSION: latest, FAKE_STATUS: status,
      GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: hourly,
      LIVE_AGENT_VERSION_FILE: state, LIVE_AGENT_REVISION_FILE: revision, GITHUB_OUTPUT: output,
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(output, 'utf8'), '', 'a failed npm lookup must not enable spending');
  }
});

test('runner paths are initialized through GITHUB_ENV before each job uses the cache', (t) => {
  const config = workflow();
  const root = temporary(t, 'live-workflow-env-');
  for (const job of Object.values(config.jobs)) {
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /runner\./,
      'job-level env cannot use the runner context');
    const output = join(root, 'env');
    writeFileSync(output, '');
    const result = shell(job.steps[0].run, {
      GITHUB_ENV: output, GITHUB_OUTPUT: join(root, 'output'), RUNNER_TEMP: root,
      ...Object.fromEntries(secretNames.map(name => [name, 'fictional-value'])),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), `LIVE_AGENT_VERSION_FILE=${root}/live-agent-version/last-version\nLIVE_AGENT_REVISION_FILE=${root}/live-agent-version/last-revision\n`);
  }
});

test('only a poll-approved paid job joins concurrency; unchanged polls skip the group', () => {
  const config = workflow();
  assert.equal(config.concurrency, undefined, 'no workflow-wide concurrency for no-op polls');
  assert.ok(config.jobs.poll && config.jobs.live, 'separate polling from the paid analysis');
  const { poll, live } = config.jobs;
  assert.equal(poll.concurrency, undefined);
  assert.equal(live.needs, 'poll');
  assert.equal(live.if, "needs.poll.outputs.run == 'true'");
  assert.equal(live.concurrency['cancel-in-progress'], 'false');
  assert.ok(live.concurrency.group);
  assert.equal(live.name, 'Live agent analysis');
  assert.equal(poll.outputs.run, '${{ steps.cli.outputs.run }}');
  assert.equal(poll.outputs.version, '${{ steps.cli.outputs.version }}');
  assert.equal(poll.outputs.revision, '${{ steps.cli.outputs.revision }}');
  for (const step of poll.steps.slice(1)) {
    assert.ok(step.if.includes("steps.credentials.outputs.ready == 'true'"));
    assert.doesNotMatch(step.run ?? '', /npm install|live-agent-check\.sh run/);
  }
});

test('a reached analysis advances the cached version even after failure, while skipped analysis preserves it', (t) => {
  const config = workflow();
  const steps = allSteps(config);
  const restore = steps.find(step => step.uses?.startsWith('actions/cache/restore@'));
  const save = steps.find(step => step.uses?.startsWith('actions/cache/save@'));
  const remember = steps.find(step => step.id === 'remember');
  const live = steps.find(step => step.name === 'Run live agent analysis');
  const poll = steps.find(step => step.id === 'cli');
  assert.ok(restore && save && remember, 'persist the last attempted version between runners');
  assert.ok(restore.with.path.includes('${{ env.LIVE_AGENT_VERSION_FILE }}'));
  assert.ok(restore.with.path.includes('${{ env.LIVE_AGENT_REVISION_FILE }}'));
  assert.equal(save.with.path, restore.with.path);
  assert.equal(save.with.key, restore.with.key);
  assert.match(save.with.key, /github\.run_id/);
  assert.match(save.with.key, /github\.run_attempt/);
  assert.ok(save.with.key.startsWith(restore.with['restore-keys'].trim()));
  assert.ok(steps.indexOf(restore) < steps.indexOf(poll));
  assert.ok(steps.indexOf(live) < steps.indexOf(remember));
  assert.ok(steps.indexOf(remember) < steps.indexOf(save));
  for (const step of [remember, save]) assert.ok(step.if.includes('always()'),
    'persistence must still run after an analysis failure');
  assert.ok(live.id, 'the paid step must expose whether it was reached');
  assert.equal(remember.env.CLI_VERSION, '${{ steps.recheck.outputs.version }}');
  assert.equal(remember.env.DEPLOY_REVISION, '${{ steps.recheck.outputs.revision }}');
  const root = temporary(t, 'live-workflow-remember-');
  const state = join(root, 'state', 'last-version');
  const revision = join(root, 'state', 'last-revision');
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'npm'), '#!/bin/bash\nprintf "0.2.10\\n"\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin', 'curl'), `#!/bin/bash\nprintf '{"ok":true,"revision":"deploy-1"}\\n'\n`, {mode:0o755});
  for (const [outcome, run, want] of [
    ['success', 'true', true], ['failure', 'true', true], ['cancelled', 'true', true],
    ['skipped', 'true', false], ['failure', 'false', false],
  ]) {
    rmSync(join(root, 'state'), { recursive: true, force: true });
    const context = {
      always: () => true, success: () => outcome === 'success',
      needs: { poll: { outputs: { run, version: '0.2.10' } } },
      steps: {
        credentials: { outputs: { ready: 'true' } }, cli: { outputs: { run, version: '0.2.10' } },
        [live.id]: { outcome }, remember: { outcome: 'skipped' },
      },
    };
    assert.equal(runInNewContext(remember.if, context), want, 'record after ' + outcome + ', run=' + run);
    if (want) {
      const result = shell(remember.run, { LIVE_AGENT_VERSION_FILE: state, LIVE_AGENT_REVISION_FILE: revision, CLI_VERSION: '0.2.10', DEPLOY_REVISION: 'deploy-1' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(state, 'utf8'), '0.2.10\n');
      assert.equal(readFileSync(revision, 'utf8'), 'deploy-1\n');
      context.steps.remember.outcome = 'success';
    }
    assert.equal(runInNewContext(save.if, context), want, 'save after ' + outcome + ', run=' + run);
    const output = join(root, 'output');
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: join(root, 'bin') + ':' + process.env.PATH, LIVE_AGENT_VERSION_FILE: state, LIVE_AGENT_REVISION_FILE: revision,
      GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: schedules(config).hourly,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=0.2.10\nrevision=deploy-1\nrun=' + !want + '\n');
  }
});

test('missing Python or PyYAML has a plain prerequisite message', (t) => {
  const root = temporary(t, 'live-workflow-python-');
  writeFileSync(join(root, 'yaml.py'), 'raise ModuleNotFoundError("fictional missing yaml")\n');
  assert.throws(() => workflow({ PATH: process.env.PATH, PYTHONPATH: root }),
    /Workflow tests require Python 3 with PyYAML/);
  assert.throws(() => workflow({ PATH: root }), /Workflow tests require Python 3 with PyYAML/);
});

test('hourly health revision changes launch the suite and malformed health never enables spending', t => {
  const poll = allSteps().find(step => step.id === 'cli');
  const root = temporary(t, 'live-health-');
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/bash\nprintf "0.2.9\\n"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\nprintf "%s\\n" "$FAKE_HEALTH"\n', { mode: 0o755 });
  const version = join(root, 'version'), revision = join(root, 'revision'), output = join(root, 'output');
  writeFileSync(version, '0.2.9\n'); writeFileSync(revision, 'eval-harness-00123-xzm\n');
  for (const [body, want] of [
    ['{"ok":true,"revision":"eval-harness-00123-xzm"}', false],
    ['{"ok":true,"revision":"eval-harness-00124-abc"}', true],
    ['{"ok":false,"revision":"eval-harness-00124-abc"}', null],
    ['{"ok":true}', null], ['not json', null], ['{"ok":true,"revision":"x\\nrun=true"}', null],
  ]) {
    writeFileSync(output, '');
    const result = shell(poll.run, { PATH: bin + ':' + process.env.PATH, FAKE_HEALTH: body,
      LIVE_AGENT_VERSION_FILE: version, LIVE_AGENT_REVISION_FILE: revision, GITHUB_OUTPUT: output,
      GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: '17 * * * *' });
    if (want === null) { assert.notEqual(result.status, 0); assert.equal(readFileSync(output, 'utf8'), ''); }
    else { assert.equal(result.status, 0, result.stderr); assert.match(readFileSync(output, 'utf8'), new RegExp('run=' + want + '\\n')); }
  }
});

test('nightly cron identity follows the Pacific offset even if Actions starts it late', t => {
  const config=workflow(),poll=allSteps(config).find(step=>step.id==='cli');
  assert.deepEqual(config.on.schedule.filter(s=>s.cron!=='17 * * * *').map(s=>s.cron),['23 10 * * *','23 11 * * *']);
  const root=temporary(t,'nightly-dst-'),bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'npm'),'#!/bin/bash\nprintf "0.2.9\\n"\n',{mode:0o755});
  writeFileSync(join(bin,'curl'),`#!/bin/bash\nprintf '{"ok":true,"revision":"deploy-1"}\\n'\n`,{mode:0o755});
  writeFileSync(join(bin,'date'),'#!/bin/bash\n[[ "$TZ" == "America/Los_Angeles" && "$1" == "+%z" ]] || exit 2\nprintf "%s\\n" "$FAKE_PACIFIC_OFFSET"\n',{mode:0o755});
  for(const [schedule,offset,want] of [['23 10 * * *','-0700',true],['23 11 * * *','-0700',false],['23 10 * * *','-0800',false],['23 11 * * *','-0800',true]]){
    const output=join(root,'output');writeFileSync(output,'');
    const result=shell(poll.run,{PATH:bin+':'+process.env.PATH,GITHUB_EVENT_NAME:'schedule',EVENT_SCHEDULE:schedule,FAKE_PACIFIC_OFFSET:offset,
      LIVE_AGENT_VERSION_FILE:join(root,'version'),LIVE_AGENT_REVISION_FILE:join(root,'revision'),GITHUB_OUTPUT:output});
    assert.equal(result.status,0,result.stderr);assert.match(readFileSync(output,'utf8'),new RegExp('run='+want+'\\n'));
  }
});
test('the serialized job refreshes attempted identities before spending on an hourly launch', t => {
  const config=workflow(),steps=config.jobs.live.steps;
  const restore=steps.find(s=>s.uses?.startsWith('actions/cache/restore@'));
  const recheck=steps.find(s=>s.id==='recheck');
  const analysis=steps.find(s=>s.id==='analysis');
  assert.ok(restore&&recheck,'refresh the cache after acquiring paid concurrency');
  assert.ok(steps.indexOf(restore)<steps.indexOf(recheck));assert.ok(steps.indexOf(recheck)<steps.indexOf(analysis));
  const root=temporary(t,'recheck-paid-'),bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'npm'),'#!/bin/bash\nprintf "0.2.9\\n"\n',{mode:0o755});
  writeFileSync(join(bin,'curl'),`#!/bin/bash\nprintf '{"ok":true,"revision":"deploy-1"}\\n'\n`,{mode:0o755});
  writeFileSync(join(bin,'date'),'#!/bin/bash\nprintf "05\\n"\n',{mode:0o755});
  const version=join(root,'version'),revision=join(root,'revision');
  writeFileSync(version,'0.2.9\n');writeFileSync(revision,'deploy-1\n');
  for(const [event,schedule,want] of [['schedule','17 * * * *',false],['schedule','23 11 * * *',true],['workflow_dispatch','',true],['release','',true]]){
    const output=join(root,'output');writeFileSync(output,'');
    const result=shell(recheck.run,{PATH:bin+':'+process.env.PATH,GITHUB_JOB:'live',GITHUB_EVENT_NAME:event,EVENT_SCHEDULE:schedule,
      LIVE_AGENT_VERSION_FILE:version,LIVE_AGENT_REVISION_FILE:revision,GITHUB_OUTPUT:output});
    assert.equal(result.status,0,result.stderr);assert.match(readFileSync(output,'utf8'),new RegExp('run='+want+'\\n'));
    assert.equal(runInNewContext(analysis.if,{steps:{recheck:{outputs:{run:String(want)}}}}),want);
  }
});

test('health outages block hourly polls but keep manual, release and nightly launches available', t => {
  const poll=allSteps().find(step=>step.id==='cli');
  const root=temporary(t,'health-outage-'),bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'npm'),'#!/bin/bash\nprintf "0.2.9\\n"\n',{mode:0o755});
  writeFileSync(join(bin,'curl'),'#!/bin/bash\nexit 22\n',{mode:0o755});
  writeFileSync(join(bin,'date'),'#!/bin/bash\nprintf "%s\\n" "-0800"\n',{mode:0o755});
  for(const [event,schedule] of [['workflow_dispatch',''],['release',''],['schedule','23 11 * * *']]) {
    const output=join(root,'output');writeFileSync(output,'');
    const result=shell(poll.run,{PATH:bin+':'+process.env.PATH,GITHUB_EVENT_NAME:event,EVENT_SCHEDULE:schedule,
      LIVE_AGENT_VERSION_FILE:join(root,'version'),LIVE_AGENT_REVISION_FILE:join(root,'revision'),GITHUB_OUTPUT:output});
    assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(output,'utf8'),'version=0.2.9\nrevision=unknown\nrun=true\n');
  }
});

test('a launch with an unknown revision preserves the last known revision so the next hourly poll skips it', t => {
  const config = workflow(), steps = allSteps(config);
  const poll = steps.find(step => step.id === 'cli');
  const remember = steps.find(step => step.id === 'remember');
  const root = temporary(t, 'unknown-revision-'), bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/bash\nprintf "0.2.10\\n"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\n[[ "$FAKE_OUTAGE" != true ]] || exit 22\nprintf \'{"ok":true,"revision":"deploy-1"}\\n\'\n', { mode: 0o755 });
  writeFileSync(join(bin, 'date'), '#!/bin/bash\nprintf "%s\\n" "-0800"\n', { mode: 0o755 });
  const version = join(root, 'version'), revision = join(root, 'revision'), output = join(root, 'output');
  const env = { PATH: bin + ':' + process.env.PATH, LIVE_AGENT_VERSION_FILE: version,
    LIVE_AGENT_REVISION_FILE: revision, GITHUB_OUTPUT: output };
  for (const [event, schedule] of [['workflow_dispatch', ''], ['release', ''], ['schedule', '23 11 * * *']]) {
    writeFileSync(version, '0.2.9\n'); writeFileSync(revision, 'deploy-1\n'); writeFileSync(output, '');
    const launch = shell(poll.run, { ...env, GITHUB_EVENT_NAME: event, EVENT_SCHEDULE: schedule, FAKE_OUTAGE: 'true' });
    assert.equal(launch.status, 0, launch.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=0.2.10\nrevision=unknown\nrun=true\n');
    const recorded = shell(remember.run, { ...env, CLI_VERSION: '0.2.10', DEPLOY_REVISION: 'unknown' });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(readFileSync(version, 'utf8'), '0.2.10\n');
    assert.equal(readFileSync(revision, 'utf8'), 'deploy-1\n');
    writeFileSync(output, '');
    const recovered = shell(poll.run, { ...env, GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: schedules(config).hourly });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=0.2.10\nrevision=deploy-1\nrun=false\n');
  }
});
