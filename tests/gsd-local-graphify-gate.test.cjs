// [gsd-local] graphify is opt-in at REGISTRATION time, not only at run time.
//
// Upstream registers gsd-graphify-update.sh on every Claude install and lets
// the script no-op unless .planning/config.json enables graphify. That still
// spawns the hook (and a node child) after every Bash call in every GSD
// project. On this fork the installer registers it only when the user-level
// defaults (~/.gsd/defaults.json) set graphify.enabled=true, removes a
// previous registration when that is no longer true, and the script resolves
// node through hooks/gsd-node-runner.sh instead of a bare `node`.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const { runNode, runHook } = require('./helpers/process-seam.cjs');
const { INSTALL_TIMEOUT_MS } = require('./helpers/timeouts.cjs');

const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');
const HOOK_SRC = path.join(__dirname, '..', 'hooks', 'gsd-graphify-update.sh');
const RESOLVER_SRC = path.join(__dirname, '..', 'hooks', 'gsd-node-runner.sh');

function install(root) {
  const r = runNode([INSTALL_SCRIPT, '--claude', '--global', '--config-dir', root], {
    env: { ...process.env, HOME: root, USERPROFILE: root },
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  assert.strictEqual(r.exitCode, 0, `install failed: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
}

function setGraphifyDefault(root, enabled) {
  fs.mkdirSync(path.join(root, '.gsd'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gsd', 'defaults.json'), JSON.stringify({ graphify: { enabled } }) + '\n');
}

function postToolCommands(settings) {
  return (settings.hooks?.PostToolUse ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ''));
}

const countGraphify = (settings) => postToolCommands(settings).filter((c) => c.includes('gsd-graphify-update')).length;

describe('[gsd-local] graphify hook registration follows ~/.gsd/defaults.json', () => {
  test('not registered when no user default enables graphify', (t) => {
    const root = createTempDir('gsd-local-graphify-off-');
    t.after(() => cleanup(root));
    const settings = install(root);
    assert.strictEqual(countGraphify(settings), 0, 'graphify registered without opt-in');
    // control: the same PostToolUse list carries other managed hooks, so a
    // zero is not an empty or unread list
    assert.ok(postToolCommands(settings).some((c) => c.includes('gsd-context-monitor')),
      'control: gsd-context-monitor must be registered in the same PostToolUse list');
    // the script itself is still staged, so enabling later needs no new files
    assert.ok(fs.existsSync(path.join(root, 'hooks', 'gsd-graphify-update.sh')));
  });

  test('registered exactly once when the user default enables graphify', (t) => {
    const root = createTempDir('gsd-local-graphify-on-');
    t.after(() => cleanup(root));
    setGraphifyDefault(root, true);
    const settings = install(root);
    assert.strictEqual(countGraphify(settings), 1);
  });

  test('a later install with graphify disabled removes the earlier registration', (t) => {
    const root = createTempDir('gsd-local-graphify-converge-');
    t.after(() => cleanup(root));
    setGraphifyDefault(root, true);
    assert.strictEqual(countGraphify(install(root)), 1, 'precondition: registered while enabled');
    setGraphifyDefault(root, false);
    const settings = install(root);
    assert.strictEqual(countGraphify(settings), 0, 'stale registration survived the disable');
    assert.ok(postToolCommands(settings).some((c) => c.includes('gsd-context-monitor')),
      'control: the removal must not take the other managed hooks with it');
  });
});

describe('[gsd-local] graphify removal and other surfaces (PR #1 review)', () => {
  test('a user hook whose path merely contains the name survives a disabled install', (t) => {
    const root = createTempDir('gsd-local-graphify-user-');
    t.after(() => cleanup(root));
    const settings = install(root);
    settings.hooks.PostToolUse.push({
      matcher: 'Bar',
      hooks: [{ type: 'command', command: '/home/me/my-gsd-graphify-update-wrapper.sh' }],
    });
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
    const after = install(root);
    assert.ok(postToolCommands(after).includes('/home/me/my-gsd-graphify-update-wrapper.sh'),
      'user-authored hook was removed as if it were the managed graphify hook');
    assert.strictEqual(countGraphify(after), 1, 'control: the user entry is still the only graphify-named one');
  });

  test('kimi config.toml follows the same opt-in', (t) => {
    const off = createTempDir('gsd-local-graphify-kimi-off-');
    const on = createTempDir('gsd-local-graphify-kimi-on-');
    t.after(() => { cleanup(off); cleanup(on); });
    setGraphifyDefault(on, true);
    const kimi = (root) => {
      const dir = path.join(root, 'kimi');
      const r = runNode([INSTALL_SCRIPT, '--kimi', '--global', '--config-dir', dir], {
        env: { ...process.env, HOME: root, USERPROFILE: root },
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      assert.strictEqual(r.exitCode, 0, `kimi install failed: ${r.stderr}`);
      // kimi's hook surface is $HOME/.kimi/config.toml, not the --config-dir
      return fs.readFileSync(path.join(root, '.kimi', 'config.toml'), 'utf8');
    };
    assert.ok(!kimi(off).includes('gsd-graphify-update'), 'kimi registered graphify without opt-in');
    // control: the enabled install does write it, so the absence above is the gate
    assert.ok(kimi(on).includes('gsd-graphify-update'), 'control: enabled kimi install must register graphify');
  });
});

describe('[gsd-local] gsd-graphify-update.sh resolves node through the runner', () => {
  test('the script and its rebuild helper have no bare node invocation', () => {
    const helper = path.join(__dirname, '..', 'hooks', 'lib', 'gsd-graphify-rebuild.sh');
    for (const file of [HOOK_SRC, helper]) {
      const body = fs.readFileSync(file, 'utf8');
      const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      assert.ok(!/(^|[\s|(])node\s+-e\b/m.test(code), `bare \`node -e\` still present in ${path.basename(file)}`);
      assert.ok(code.includes('gsd-node-runner.sh'), `${path.basename(file)} does not call the node runner`);
    }
  });

  test('with no node anywhere the hook fails visibly instead of passing silently', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const home = createTempDir('gsd-local-graphify-nonode-');
    t.after(() => cleanup(home));
    const hooks = path.join(home, '.claude', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.copyFileSync(HOOK_SRC, path.join(hooks, 'gsd-graphify-update.sh'));
    fs.copyFileSync(RESOLVER_SRC, path.join(hooks, 'gsd-node-runner.sh'));
    const project = path.join(home, 'proj');
    fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), '{}\n');
    const emptyBin = createTempDir('gsd-local-graphify-emptybin-');
    t.after(() => cleanup(emptyBin));
    const r = runHook(path.join(hooks, 'gsd-graphify-update.sh'), [], {
      interpreter: 'bash',
      cwd: project,
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }),
      env: { ...process.env, HOME: home, CI: '', PATH: `${emptyBin}:/usr/bin:/bin`, GSD_NODE_RUNNER_NO_FALLBACKS: '1' },
      timeoutMs: 20000,
    });
    assert.strictEqual(r.exitCode, 1, `stderr: ${r.stderr}`);
    assert.match(r.stderr, /gsd-node-runner: no usable node found/);
  });

  test('a missing runner still exits 1, never 2 (PostToolUse must not block)', (t) => {
    if (process.platform === 'win32') { t.skip('POSIX sh execution lane'); return; }
    const home = createTempDir('gsd-local-graphify-norunner-');
    t.after(() => cleanup(home));
    const hooks = path.join(home, '.claude', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.copyFileSync(HOOK_SRC, path.join(hooks, 'gsd-graphify-update.sh'));
    const project = path.join(home, 'proj');
    fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(project, '.planning', 'config.json'), '{}\n');
    const r = runHook(path.join(hooks, 'gsd-graphify-update.sh'), [], {
      interpreter: 'bash',
      cwd: project,
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }),
      env: { ...process.env, HOME: home, CI: '' },
      timeoutMs: 20000,
    });
    assert.strictEqual(r.exitCode, 1, `stderr: ${r.stderr}`);
  });
});
