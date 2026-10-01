// [gsd-local] gsd-validate-commit.sh, gsd-phase-boundary.sh and gsd-session-state.sh
// resolve node through hooks/gsd-node-runner.sh, never a bare `node`.
//
// gsd-validate-commit.sh is a PreToolUse guard. With a bare `node` and no node on
// the hook's PATH, every call site failed with 127 and the #3838 "could not run"
// branches turned that into exit 0: the guard failed OPEN, outside guarantee (b)
// of the runner (ADR-0135). Now an unresolvable node, in a project that enables
// the hook, on a command that may be a commit, blocks (exit 2) and says why. Since
// the second re-review (operator decision 2026-10-01) the same holds for ANY
// config-read failure without the inline script's CONFIG_READ_FAILED marker (runner
// missing, a node that resolves but never runs); a node that RAN and reported
// CONFIG_READ_FAILED keeps the #3838 fail-open.
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
const strippedBins = new Map();
function strippedPath(drop) {
  const key = drop.join(',');
  if (strippedBins.has(key)) return strippedBins.get(key);
  const dir = createTempDir('gsd-local-vc-node-nonode-bin-');
  for (const src of ['/usr/bin', '/bin']) {
    let names = [];
    try { names = fs.readdirSync(src); } catch { continue; }
    for (const n of names) {
      if (drop.some((d) => n === d || n.startsWith(d + '.') || /^python3/.test(d) && /^python3(\.\d+)?$/.test(n))) continue;
      const dst = path.join(dir, n);
      if (!fs.existsSync(dst)) { try { fs.symlinkSync(path.join(src, n), dst); } catch { /* skip */ } }
    }
  }
  strippedBins.set(key, dir);
  return dir;
}
const nodeFreePath = () => strippedPath(['node', 'nodejs']);
const nodeAndPythonFreePath = () => strippedPath(['node', 'nodejs', 'python3', 'python']);
after(() => { for (const d of strippedBins.values()) cleanup(d); });

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
  const py = runHook('-c', ['command -v python3 || command -v python'], {
    interpreter: '/bin/bash', env: { ...process.env, PATH: nodeAndPythonFreePath() }, timeoutMs: 5000,
  });
  assert.strictEqual(py.exitCode, 1, `python resolves on the python-free PATH: ${py.stdout}`);
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
  // NIT-2 (#3 re-review): the shell decision must not miss a key written with a JSON escape
  const ESCAPED_ON = '{"hooks":{"\\u0063ommunity":true}}\n';
  const rawProject = (t, text) => {
    const dir = createTempDir('gsd-local-vc-node-proj-');
    t.after(() => cleanup(dir));
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), text);
    return dir;
  };
  test('escaped "community" key, python present -> exit 2 (decoded exactly)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: rawProject(t, ESCAPED_ON), input: NONCONFORMING });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /commit blocked/);
  });
  test('escaped "community" key, no python either -> exit 2 (any \\u escape counts as may-enable)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: rawProject(t, ESCAPED_ON), input: NONCONFORMING, env: { PATH: nodeAndPythonFreePath() } });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /commit blocked/);
  });
  test('control: community:false, no python -> exit 0, not blocked', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, { hooks: { community: false } }), input: NONCONFORMING, env: { PATH: nodeAndPythonFreePath() } });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });
  test('control: escaped key set FALSE, python present -> exit 0 (python decides exactly)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: rawProject(t, '{"hooks":{"\\u0063ommunity":false}}\n'), input: NONCONFORMING });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });

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
    // MEDIUM-4 (second re-review): a user's own hooks/gsd-find-project-root.sh is not GSD's.
    // Install must leave it byte-identical; GSD ships its copy in hooks/lib/.
    const USER_FINDER = '# v2026.06.13 user-owned helper, not GSD\n';
    fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'hooks', 'gsd-find-project-root.sh'), USER_FINDER);
    const b = runNode([BUILD_HOOKS_SCRIPT], { timeoutMs: INSTALL_TIMEOUT_MS });
    assert.strictEqual(b.exitCode, 0, `build-hooks failed: ${b.stderr}`);
    const r = runNode([INSTALL_SCRIPT, '--claude', '--global', '--config-dir', root], {
      // keep: the documented non-TTY deploy setting (159-03); the user file above is a
      // GSD-looking unmanaged file, which otherwise aborts the install for a decision.
      env: { ...process.env, HOME: root, USERPROFILE: root, GSD_INSTALLER_MIGRATION_RESOLVE: 'keep' },
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
    for (const rel of ['gsd-graphify-update.sh', 'lib/gsd-graphify-rebuild.sh', 'gsd-node-runner.sh', 'lib/gsd-find-project-root.sh']) {
      const expected = fs.readFileSync(path.join(HOOKS_DIR, rel), 'utf8')
        .replace(/\{\{GSD_VERSION\}\}/g, version)
        .replace(/\{\{GSD_NODE_TOKEN\}\}/g, () => baked);
      assert.strictEqual(fs.readFileSync(path.join(root, 'hooks', rel), 'utf8'), expected, `${rel}: installed copy differs from the source under review`);
    }
    // The advisory hooks find the project root through gsd-find-project-root.sh. It must ship
    // beside them and be sourced from there: a HOME without ~/.claude/hooks/ (any runtime but
    // this machine's Claude) killed both hooks at the `.` line under set -e (#3 re-review).
    assert.ok(fs.existsSync(path.join(root, 'hooks', 'lib', 'gsd-find-project-root.sh')), 'lib/gsd-find-project-root.sh not installed');
    assert.strictEqual(fs.readFileSync(path.join(root, 'hooks', 'gsd-find-project-root.sh'), 'utf8'), USER_FINDER, 'install touched the user-owned hooks/gsd-find-project-root.sh');
    const bareHome = createTempDir('gsd-local-vc-node-barehome-');
    t.after(() => cleanup(bareHome));
    const proj = project(t, ENABLED);
    const pb = runHook(path.join(root, 'hooks', 'gsd-phase-boundary.sh'), [], {
      interpreter: '/bin/bash', cwd: proj,
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(proj, '.planning', 'STATE.md') } }),
      env: { ...process.env, HOME: bareHome, CLAUDE_CWD: proj, PATH: nodeFreePath(), GSD_NODE_RUNNER_NO_FALLBACKS: '1', GSD_NODE: '' },
      timeoutMs: 15000,
    });
    assert.strictEqual(pb.exitCode, 0, `phase-boundary under a bare HOME: ${pb.stderr}`);
    assert.match(pb.stdout, /"planning_modified":true/, `phase-boundary produced no reminder: ${pb.stdout} ${pb.stderr}`);
    const hr = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, hook: path.join(root, 'hooks', 'gsd-validate-commit.sh') });
    assert.strictEqual(hr.exitCode, 2, `stderr: ${hr.stderr}`);
    assert.doesNotMatch(hr.stderr, /validator disabled|no usable node/);
  });
});

// gsd-core#3 second re-review (2026-10-01). Each row below failed against be657aae.
describe('[gsd-local] fail-closed holds when the shell fallbacks themselves break', () => {
  const fakeBin = (t, name, body) => {
    const dir = createTempDir('gsd-local-vc-node-fake-');
    t.after(() => cleanup(dir));
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return dir;
  };

  // HIGH-1: python3 that cannot start exits 1 — the same code that meant "not enabled".
  for (const [label, body] of [['exit 1 (startup failure)', 'exit 1'], ['exit 127', 'exit 127']]) {
    test(`python3 ${label}, enabled project -> exit 2 (grep fallback decides)`, (t) => {
      if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
      const bin = fakeBin(t, 'python3', body);
      const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, env: { PATH: `${bin}${path.delimiter}${nodeAndPythonFreePath()}` } });
      assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
      assert.match(r.stderr, /commit blocked/);
    });
  }
  test('python3 with PYTHONHOME=/nonexistent, enabled project -> exit 2', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, env: { PYTHONHOME: '/nonexistent' } });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /commit blocked/);
  });
  test('control: broken python3, community:false -> grep decides not-enabled, exit 0', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const bin = fakeBin(t, 'python3', 'exit 1');
    const r = fire(t, { cwd: project(t, { hooks: { community: false } }), input: NONCONFORMING, env: { PATH: `${bin}${path.delimiter}${nodeAndPythonFreePath()}` } });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });

  // MEDIUM-1: spellings the classifier reads as `commit` but a raw grep for "commit" misses.
  for (const cmd of [`git c'o'mmit -m "wibble"`, 'git co""mmit -m "wibble"', 'git co\\mmit -m "wibble"', `git $'\\x63ommit' -m "wibble"`]) {
    test(`no node, enabled, ${JSON.stringify(cmd)} -> exit 2`, (t) => {
      if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
      const r = fire(t, { cwd: project(t, ENABLED), input: payload(cmd) });
      assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
      assert.match(r.stderr, /commit blocked/);
    });
  }

  // LOW-1: only the command is matched, not cwd / description / transcript_path.
  test('no node, enabled, `ls` with "commit" only in other payload fields -> exit 0 (python extracts the command)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/home/u/commit-tracker', transcript_path: '/tmp/commit.jsonl', tool_name: 'Bash', tool_input: { command: 'ls -la', description: 'list before commit' } });
    const r = fire(t, { cwd: project(t, ENABLED), input });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /commit blocked/);
  });

  // MEDIUM-2 (operator decision 2026-10-01): any config-read failure WITHOUT the inline script's
  // CONFIG_READ_FAILED marker means node never ran the script -> fail closed.
  test('GSD_NODE=/bin/false (resolves, never runs the script), enabled -> exit 2', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, env: { GSD_NODE: '/bin/false' } });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /commit blocked/);
  });
  test('runner file missing beside the hook, enabled -> exit 2', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const dir = createTempDir('gsd-local-vc-node-norunner-');
    t.after(() => cleanup(dir));
    const hook = path.join(dir, 'gsd-validate-commit.sh');
    fs.copyFileSync(HOOK_SRC, hook);
    const r = fire(t, { cwd: project(t, ENABLED), input: NONCONFORMING, hook, env: { GSD_NODE: process.execPath } });
    assert.strictEqual(r.exitCode, 2, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /commit blocked/);
  });
  test('control: node RAN and reported CONFIG_READ_FAILED (malformed config) -> #3838 fail-open, exit 0', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const dir = createTempDir('gsd-local-vc-node-proj-');
    t.after(() => cleanup(dir));
    fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), '{"hooks":{"community":true},\n');
    const r = fire(t, { cwd: dir, input: NONCONFORMING, env: { GSD_NODE: process.execPath } });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /CONFIG_READ_FAILED/);
    assert.match(r.stderr, /validator disabled for this call/);
  });
});

describe('[gsd-local] advisory hooks outside any GSD project, and odd project paths', () => {
  const ADVISORY = ['gsd-phase-boundary.sh', 'gsd-session-state.sh'];
  // MEDIUM-3: find_gsd_project_root returns 1 under set -e; the hook must exit 0 silently.
  for (const name of ADVISORY) {
    test(`${name} outside any project -> exit 0, empty stderr`, (t) => {
      if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
      const dir = createTempDir('gsd-local-vc-node-noproj-');
      t.after(() => cleanup(dir));
      const r = runHook(path.join(HOOKS_DIR, name), [], {
        interpreter: '/bin/bash', cwd: dir, input: '{}',
        env: { ...process.env, CLAUDE_CWD: dir, GSD_NODE: process.execPath },
        timeoutMs: 15000,
      });
      assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
      assert.strictEqual(r.stderr, '');
    });
  }
  // LOW-3: a project path with a quote must not break (or inject into) the inline JS.
  test("gsd-phase-boundary.sh in a project whose path contains ' -> exit 0 with the reminder", (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const parent = createTempDir('gsd-local-vc-node-quote-');
    t.after(() => cleanup(parent));
    const proj = path.join(parent, "o'brien");
    fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.planning', 'config.json'), JSON.stringify(ENABLED));
    const r = runHook(path.join(HOOKS_DIR, 'gsd-phase-boundary.sh'), [], {
      interpreter: '/bin/bash', cwd: proj,
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(proj, '.planning', 'STATE.md') } }),
      env: { ...process.env, CLAUDE_CWD: proj, GSD_NODE: process.execPath },
      timeoutMs: 15000,
    });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /"planning_modified":true/);
  });
  test("gsd-session-state.sh in a project whose path contains ' -> exit 0, config_mode read", (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const parent = createTempDir('gsd-local-vc-node-quote-');
    t.after(() => cleanup(parent));
    const proj = path.join(parent, "o'brien");
    fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.planning', 'config.json'), JSON.stringify({ ...ENABLED, mode: 'yolo' }));
    const r = runHook(path.join(HOOKS_DIR, 'gsd-session-state.sh'), [], {
      interpreter: '/bin/bash', cwd: proj, input: '{}',
      env: { ...process.env, CLAUDE_CWD: proj, GSD_NODE: process.execPath },
      timeoutMs: 15000,
    });
    assert.strictEqual(r.exitCode, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /"config_mode":"yolo"/);
  });
});

describe('[gsd-local] bare-node detector covers every command-position prefix', () => {
  const { BARE_NODE_RE } = require('./helpers/bare-node.cjs');
  // LOW-2: one positive control per form; each must be flagged.
  const POSITIVE = [
    'node -e "x"', 'X=1 node -e "x"', 'VAR="a b" node -e "x"', 'env node -e "x"', 'exec node "$S"',
    'command node -e "x"', 'time node -e "x"', '! node -e "x"', 'if node -e "x"; then :; fi',
    'then node -e "x"', 'echo `node -e "x"`', 'node script.js', 'a=$(node -p 1)', 'true && node -e x',
  ];
  for (const line of POSITIVE) {
    test(`flags: ${line}`, () => assert.ok(BARE_NODE_RE.test(line), line));
  }
  const NEGATIVE = ['gsd_node -e "x"', 'echo "no node could be resolved"', '# node -e x', 'GSD_NODE_BAKED=/usr/bin/node'];
  for (const line of NEGATIVE) {
    test(`does not flag: ${line}`, () => assert.ok(!BARE_NODE_RE.test(line) || /^\s*#/.test(line), line));
  }
});
