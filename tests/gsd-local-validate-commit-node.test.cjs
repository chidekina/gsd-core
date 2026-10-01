// [gsd-local] gsd-validate-commit.sh, gsd-phase-boundary.sh and gsd-session-state.sh
// resolve node through hooks/gsd-node-runner.sh, never a bare `node`.
//
// gsd-validate-commit.sh is a PreToolUse guard. With a bare `node` and no node on
// the hook's PATH, every call site failed with 127 and the #3838 "could not run"
// branches turned that into exit 0: the guard failed OPEN, outside guarantee (b)
// of the runner (ADR-0135). Now an unresolvable node, in a project that enables
// the hook, on a command that may be a commit, blocks (exit 2) and says why. A
// node that RESOLVES but fails one call keeps the #3838 fail-open (pinned by
// gsd-validate-commit-crash-policy.test.cjs).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const { runNode, runHook } = require('./helpers/process-seam.cjs');
const { INSTALL_TIMEOUT_MS } = require('./helpers/timeouts.cjs');

const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');
const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const HOOK_SRC = path.join(HOOKS_DIR, 'gsd-validate-commit.sh');
const NODE_SH_HOOKS = ['gsd-validate-commit.sh', 'gsd-phase-boundary.sh', 'gsd-session-state.sh'];

const payload = (command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
const CONFORMING = payload('git commit -m "feat: add thing"');
const NONCONFORMING = payload('git commit -m "wibble wobble"');

function project(t, config) {
  const dir = createTempDir('gsd-local-vc-node-proj-');
  t.after(() => cleanup(dir));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify(config) + '\n');
  return dir;
}

// No node on PATH and no runner fallbacks: only GSD_NODE (or the stamped token)
// can resolve one.
function fire(t, { cwd, input, env = {}, hook = HOOK_SRC }) {
  const emptyBin = createTempDir('gsd-local-vc-node-emptybin-');
  t.after(() => cleanup(emptyBin));
  return runHook(hook, [], {
    interpreter: '/bin/bash',
    cwd,
    input,
    env: { ...process.env, CI: '', PATH: `${emptyBin}:/usr/bin:/bin`, GSD_NODE_RUNNER_NO_FALLBACKS: '1', GSD_NODE: '', ...env },
    timeoutMs: 15000,
  });
}

const ENABLED = { hooks: { community: true } };

describe('[gsd-local] gsd-validate-commit.sh with no resolvable node', () => {
  test('enabled project, commit command -> exit 2 naming the missing node (fails CLOSED)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /no usable node/);
    assert.match(r.stderr, /commit blocked/);
  });

  // The controls assert "not blocked", not "silent": with no node the #3838
  // config-read diagnostic still prints (upstream wants that noise for a
  // malformed config, which a shell pre-filter cannot tell apart).
  test('control: project that does not enable the hook -> exit 0, not blocked', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, { hooks: { community: false } }), input: NONCONFORMING });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });

  test('control: enabled project, command that is not a commit -> exit 0, not blocked', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: payload('ls -la') });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });
});

describe('[gsd-local] gsd-validate-commit.sh resolves node through the runner at every site', () => {
  // A bare `node` at ANY site fails here (no node on PATH) and its #3838 branch
  // passes the non-conforming commit with exit 0.
  test('GSD_NODE only: non-conforming commit is still blocked', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, env: { GSD_NODE: process.execPath } });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /validator disabled|no usable node/);
  });

  test('GSD_NODE only: conforming commit passes with no diagnostic', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: CONFORMING, env: { GSD_NODE: process.execPath } });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.strictEqual(r.stderr, '');
  });

  test('no bare `node` invocation left in the three .sh hooks', () => {
    for (const name of NODE_SH_HOOKS) {
      const body = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const bare = body.split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => !/^\s*#/.test(line) && /(^|[\s($|;&])node\s+-e\b/.test(line));
      assert.deepStrictEqual(bare, [], `${name} still calls bare node at line(s) ${bare.map(([n]) => n).join(', ')}`);
      // control: the file does call node, through gsd_node
      assert.match(body, /\bgsd_node\s+-e\b/, `${name} has no gsd_node call: the check above would pass vacuously`);
    }
  });
});

describe('[gsd-local] installed .sh hooks carry the install-time node', () => {
  test('stamped, and the stamped guard blocks with no node on PATH', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const root = createTempDir('gsd-local-vc-node-install-');
    t.after(() => cleanup(root));
    const r = runNode([INSTALL_SCRIPT, '--claude', '--global', '--config-dir', root], {
      env: { ...process.env, HOME: root, USERPROFILE: root },
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    assert.strictEqual(r.exitCode, 0, `install failed: ${r.stderr}`);
    for (const name of NODE_SH_HOOKS) {
      const body = fs.readFileSync(path.join(root, 'hooks', name), 'utf8');
      assert.ok(!body.includes('{{GSD_NODE_TOKEN}}'), `${name} left unstamped`);
      const m = body.match(/^GSD_NODE_BAKED=("[^"\n]*")$/m);
      assert.ok(m, `${name} has no GSD_NODE_BAKED line`);
      assert.ok(/\/node(\.exe)?"$/.test(m[1]), `${name} baked token is not a node path: ${m[1]}`);
    }
    const hr = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, hook: path.join(root, 'hooks', 'gsd-validate-commit.sh') });
    assert.strictEqual(hr.exitCode, 2, `stderr: ${hr.stderr}`);
    assert.doesNotMatch(hr.stderr, /validator disabled|no usable node/);
  });
});
