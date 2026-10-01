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
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const { runNode, runHook } = require('./helpers/process-seam.cjs');
const { INSTALL_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { BUILD_HOOKS_SCRIPT } = require('./helpers/hooks-dist.cjs');
const { bareNodeLines } = require('./helpers/bare-node.cjs');

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

// A PATH with every tool of /usr/bin and /bin EXCEPT node: on a host whose
// distro ships /usr/bin/node, a plain `/usr/bin:/bin` PATH would let a bare
// `node` resolve and every "routed through the runner" assertion pass
// vacuously (gsd-core#3 review, MED-2).
let nodeFreeBin;
function nodeFreePath() {
  if (nodeFreeBin) return nodeFreeBin;
  nodeFreeBin = createTempDir('gsd-local-vc-node-nonode-bin-');
  for (const dir of ['/usr/bin', '/bin']) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (n === 'node' || n === 'nodejs') continue;
      const dst = path.join(nodeFreeBin, n);
      if (!fs.existsSync(dst)) { try { fs.symlinkSync(path.join(dir, n), dst); } catch { /* skip */ } }
    }
  }
  return nodeFreeBin;
}
after(() => { if (nodeFreeBin) cleanup(nodeFreeBin); });

// No node on PATH and no runner fallbacks: only GSD_NODE (or the stamped token)
// can resolve one.
function fire(t, { cwd, input, env = {}, hook = HOOK_SRC }) {
  return runHook(hook, [], {
    interpreter: '/bin/bash',
    cwd,
    input,
    env: { ...process.env, CI: '', PATH: nodeFreePath(), GSD_NODE_RUNNER_NO_FALLBACKS: '1', GSD_NODE: '', ...env },
    timeoutMs: 15000,
  });
}

test('CONTROL: the test PATH really has no node (else the routing assertions are vacuous)', (t) => {
  if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
  // runHook spawns `<interpreter> <target> ...args`, so the target is `-c`
  const r = runHook('-c', ['command -v node || command -v nodejs'], {
    interpreter: '/bin/bash', env: { ...process.env, PATH: nodeFreePath() }, timeoutMs: 5000,
  });
  assert.strictEqual(r.exitCode, 1, `node resolves on the test PATH (or bash did not run): ${r.stdout}${r.stderr}`);
  // and the PATH is not empty: the hook's own tools resolve
  const g = runHook('-c', ['command -v grep && command -v tr && command -v mktemp'], {
    interpreter: '/bin/bash', env: { ...process.env, PATH: nodeFreePath() }, timeoutMs: 5000,
  });
  assert.strictEqual(g.exitCode, 0, `test PATH lacks coreutils: ${g.stderr}`);
});

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
      const bare = bareNodeLines(body);
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
    // Rebuild hooks/dist unconditionally: install copies from dist, and a dist
    // present but older than the source shipped a superseded guard while this
    // test passed (gsd-core#3 review, MED-1). Then compare CONTENT below.
    const b = runNode([BUILD_HOOKS_SCRIPT], { timeoutMs: INSTALL_TIMEOUT_MS });
    assert.strictEqual(b.exitCode, 0, `build-hooks failed: ${b.stderr}`);
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
      // installed body == reviewed source, with only the two install stamps applied
      const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
      const expected = fs.readFileSync(path.join(HOOKS_DIR, name), 'utf8')
        .replace(/\{\{GSD_VERSION\}\}/g, version)
        .replace(/\{\{GSD_NODE_TOKEN\}\}/g, () => m[1]);
      assert.strictEqual(body, expected, `${name}: installed copy differs from the source under review`);
    }
    // the other shell files the fork routes through the runner: same content pin
    const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
    const baked = fs.readFileSync(path.join(root, 'hooks', 'gsd-validate-commit.sh'), 'utf8').match(/^GSD_NODE_BAKED=("[^"\n]*")$/m)[1];
    for (const rel of ['gsd-graphify-update.sh', 'lib/gsd-graphify-rebuild.sh', 'gsd-node-runner.sh']) {
      const expected = fs.readFileSync(path.join(HOOKS_DIR, rel), 'utf8')
        .replace(/\{\{GSD_VERSION\}\}/g, version)
        .replace(/\{\{GSD_NODE_TOKEN\}\}/g, () => baked);
      assert.strictEqual(fs.readFileSync(path.join(root, 'hooks', rel), 'utf8'), expected, `${rel}: installed copy differs from the source under review`);
    }
    const hr = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, hook: path.join(root, 'hooks', 'gsd-validate-commit.sh') });
    assert.strictEqual(hr.exitCode, 2, `stderr: ${hr.stderr}`);
    assert.doesNotMatch(hr.stderr, /validator disabled|no usable node/);
  });
});
