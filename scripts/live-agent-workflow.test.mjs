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
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 5000,
  });
}

function schedules(config) {
  return {
    hourly: config.on.schedule.find(entry => entry.cron.split(' ').slice(1).every(part => part === '*'))?.cron,
    weekly: config.on.schedule.find(entry => /^[0-6]$/.test(entry.cron.split(' ')[4]))?.cron,
  };
}

function allSteps(config = workflow()) {
  return Object.values(config.jobs).flatMap(job => job.steps);
}

test('live analysis responds to releases, manual requests, weekly runs and hourly npm polling', () => {
  const config = workflow();
  assert.deepEqual(Object.keys(config.on).sort(), ['release', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(config.on.release.types, ['published']);
  assert.equal(config.on.schedule.length, 2);
  const { hourly, weekly } = schedules(config);
  assert.ok(hourly, 'poll npm every hour');
  assert.ok(weekly, 'retain an unconditional weekly analysis');
  assert.ok(Number(hourly.split(' ')[0]) < 60);
  assert.deepEqual(weekly.split(' ').slice(2, 4), ['*', '*']);
});

test('live analysis scopes secrets, pins dependencies and bounds each paid run', () => {
  const config = workflow();
  assert.deepEqual(config.permissions, { contents: 'read' });
  for (const job of Object.values(config.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(Number(job['timeout-minutes']) <= 90);
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
  assert.match(live.run, /scripts\/live-agent-check\.sh run --confirm-paid --max-dollars 5(?:\s|$)/);
  const seconds = Number(live.run.match(/--timeout-seconds (\d+)/)?.[1]);
  const job = Object.values(config.jobs).find(job => job.steps.includes(live));
  assert.ok(seconds > 0 && seconds * 4 < Number(job['timeout-minutes']) * 60 - 600,
    'four commands must leave time for setup and cleanup');
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

test('workflow analyzes the original one-file fixture without privileged preparation', () => {
  const steps = allSteps();
  const live = steps.find(step => step.name === 'Run live agent analysis');
  assert.match(live.run, /--agent-dir "\$GITHUB_WORKSPACE\/scripts\/fixtures\/live-agent"/);
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

test('npm polling runs for changed versions; release, weekly and manual analyses always run', (t) => {
  const config = workflow();
  const poll = allSteps(config).find(step => step.id === 'cli');
  assert.ok(poll, 'the npm version gate must exist');
  const { hourly, weekly } = schedules(config);
  assert.equal(poll.env.EVENT_SCHEDULE, '${{ github.event.schedule }}');
  const root = temporary(t, 'live-workflow-version-');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/bash\n[[ "$*" == "view @counterfact-labs/cli version" ]] || exit 9\nprintf "%s\\n" "$FAKE_VERSION"\nexit "${FAKE_STATUS:-0}"\n', { mode: 0o755 });
  const state = join(root, 'last-version');
  const output = join(root, 'output');
  for (const [event, schedule, previous, latest, want] of [
    ['schedule', hourly, null, '0.2.9', true],
    ['schedule', hourly, '0.2.9', '0.2.9', false],
    ['schedule', '42 * * * *', '0.2.9', '0.2.9', false],
    ['schedule', hourly, '0.2.9', '0.2.10', true],
    ['schedule', hourly, '0.2.10', '0.2.9', true],
    ['schedule', hourly, 'corrupt', '0.2.9', true],
    ['schedule', weekly, '0.2.9', '0.2.9', true],
    ['workflow_dispatch', '', '0.2.9', '0.2.9', true],
    ['release', '', '0.2.9', '0.2.9', true],
  ]) {
    rmSync(state, { force: true });
    if (previous !== null) writeFileSync(state, previous + '\n');
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: bin + ':' + process.env.PATH, FAKE_VERSION: latest,
      GITHUB_EVENT_NAME: event, EVENT_SCHEDULE: schedule,
      LIVE_AGENT_VERSION_FILE: state, GITHUB_OUTPUT: output,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=' + latest + '\nrun=' + want + '\n');
    assert.equal(existsSync(state), previous !== null, 'polling must not record an analysis as successful');
    if (previous !== null) assert.equal(readFileSync(state, 'utf8'), previous + '\n');
  }
  for (const [latest, status] of [['', '0'], ['not-a-version', '0'], ['0.2.9\nrun=false', '0'], ['0.2.9', '1']]) {
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: bin + ':' + process.env.PATH, FAKE_VERSION: latest, FAKE_STATUS: status,
      GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: hourly,
      LIVE_AGENT_VERSION_FILE: state, GITHUB_OUTPUT: output,
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
    assert.equal(readFileSync(output, 'utf8'), `LIVE_AGENT_VERSION_FILE=${root}/live-agent-version/last-version\n`);
  }
});

test('only a poll-approved paid job joins concurrency, so hourly no-ops cannot replace pending analyses', () => {
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
  assert.equal(restore.with.path, '${{ env.LIVE_AGENT_VERSION_FILE }}');
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
  assert.equal(remember.env.CLI_VERSION, '${{ needs.poll.outputs.version }}');
  const root = temporary(t, 'live-workflow-remember-');
  const state = join(root, 'state', 'last-version');
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'npm'), '#!/bin/bash\nprintf "0.2.10\\n"\n', { mode: 0o755 });
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
      const result = shell(remember.run, { LIVE_AGENT_VERSION_FILE: state, CLI_VERSION: '0.2.10' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(state, 'utf8'), '0.2.10\n');
      context.steps.remember.outcome = 'success';
    }
    assert.equal(runInNewContext(save.if, context), want, 'save after ' + outcome + ', run=' + run);
    const output = join(root, 'output');
    writeFileSync(output, '');
    const result = shell(poll.run, {
      PATH: join(root, 'bin') + ':' + process.env.PATH, LIVE_AGENT_VERSION_FILE: state,
      GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'schedule', EVENT_SCHEDULE: schedules(config).hourly,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'version=0.2.10\nrun=' + !want + '\n');
  }
});

test('missing Python or PyYAML has a plain prerequisite message', (t) => {
  const root = temporary(t, 'live-workflow-python-');
  writeFileSync(join(root, 'yaml.py'), 'raise ModuleNotFoundError("fictional missing yaml")\n');
  assert.throws(() => workflow({ PATH: process.env.PATH, PYTHONPATH: root }),
    /Workflow tests require Python 3 with PyYAML/);
  assert.throws(() => workflow({ PATH: root }), /Workflow tests require Python 3 with PyYAML/);
});
