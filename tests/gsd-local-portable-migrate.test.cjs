// [gsd-local] --portable-hooks must MIGRATE an existing install, not only a fresh one.
//
// Upstream's rewriter skips every command already in the runtime-resolving
// chain shape, and registration is only-if-absent, so re-running the installer
// with --portable-hooks over a plain install changed nothing: every managed JS
// hook kept the inline chain. With no node that chain expands to "" and exits
// 127 (non-blocking), so a PreToolUse guard fails OPEN, while the fail-closed
// exit-2 branch lives only in hooks/gsd-node-runner.sh (ADR-0135 Decisão 4 b).
// Measured on the operator's config 2026-09-30: 14 chain, 0 runner after a
// --portable-hooks reinstall.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const { runNode } = require('./helpers/process-seam.cjs');
const { INSTALL_TIMEOUT_MS } = require('./helpers/timeouts.cjs');

const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');
const CHAIN = /^"\$\(for n in /;
const RUNNER = /gsd-node-runner\.sh"/;
const USER_CHAIN_COMMAND =
  '"$(for n in "/usr/bin/node" "$(command -v node)"; do [ -x "$n" ] && printf \'%s\' "$n" && break; done)" "/home/u/own-tools/my-hook.js"';

function install(root, extra = []) {
  const r = runNode([INSTALL_SCRIPT, '--claude', '--global', '--config-dir', root, ...extra], {
    env: { ...process.env, HOME: root, USERPROFILE: root, GSD_PORTABLE_HOOKS: '' },
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  assert.strictEqual(r.exitCode, 0, `install failed: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
}

function commands(settings) {
  return Object.values(settings.hooks ?? {}).flatMap((groups) =>
    groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? '')),
  );
}

const managedJs = (settings) => commands(settings).filter((c) => /\/hooks\/gsd-[a-z-]+\.js"?\s*$/.test(c));

function plantUserHook(root) {
  const file = path.join(root, 'settings.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  s.hooks.PreToolUse = s.hooks.PreToolUse ?? [];
  s.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: USER_CHAIN_COMMAND }] });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

describe('[gsd-local] --portable-hooks migrates an existing install to the node runner', () => {
  test('a plain install then a --portable-hooks reinstall leaves no managed chain command', (t) => {
    const root = createTempDir('gsd-local-portmig-');
    t.after(() => cleanup(root));
    const before = install(root);
    const chainBefore = managedJs(before).filter((c) => CHAIN.test(c)).length;
    assert.ok(chainBefore >= 5, `control: the plain install must emit chain commands (got ${chainBefore})`);

    const after = install(root, ['--portable-hooks']);
    const js = managedJs(after);
    assert.equal(js.filter((c) => CHAIN.test(c)).length, 0, `chain survived:\n${js.filter((c) => CHAIN.test(c)).join('\n')}`);
    assert.equal(js.filter((c) => RUNNER.test(c)).length, chainBefore, 'every migrated managed hook must route through the runner');
    assert.equal(managedJs(after).length, managedJs(before).length, 'migration must not add or drop registrations');
  });

  test('a user hook in chain shape is never rewritten', (t) => {
    const root = createTempDir('gsd-local-portmig-user-');
    t.after(() => cleanup(root));
    install(root);
    plantUserHook(root);
    const after = install(root, ['--portable-hooks']);
    assert.equal(commands(after).filter((c) => c === USER_CHAIN_COMMAND).length, 1, 'user chain hook changed or vanished');
    assert.ok(managedJs(after).some((c) => RUNNER.test(c)), 'control: the managed hooks in the same file did migrate');
  });

  test('a --local reinstall with --portable-hooks leaves the project-relative commands alone', (t) => {
    // --local ignores the flag (its commands are $CLAUDE_PROJECT_DIR-anchored).
    // Re-deriving them through the GLOBAL builder would point them at the
    // project's .claude as if it were a config root.
    const project = createTempDir('gsd-local-portmig-local-');
    t.after(() => cleanup(project));
    const run = (extra) => {
      const r = runNode([INSTALL_SCRIPT, '--claude', '--local', ...extra], {
        cwd: project,
        env: { ...process.env, HOME: project, USERPROFILE: project, GSD_PORTABLE_HOOKS: '' },
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      assert.strictEqual(r.exitCode, 0, `local install failed: ${r.stderr}`);
      return JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.local.json'), 'utf8'));
    };
    const before = managedJs(run([]));
    assert.ok(before.length >= 5 && before.every((c) => CHAIN.test(c)), 'control: local install emits chain commands');
    const after = managedJs(run(['--portable-hooks']));
    assert.deepEqual(after, before);
  });

  test('a reinstall WITHOUT --portable-hooks keeps the chain (the migration is opt-in)', (t) => {
    const root = createTempDir('gsd-local-portmig-plain-');
    t.after(() => cleanup(root));
    install(root);
    const again = install(root);
    assert.equal(managedJs(again).filter((c) => RUNNER.test(c)).length, 0);
    assert.ok(managedJs(again).filter((c) => CHAIN.test(c)).length >= 5);
  });
});

// Unit arms on the function itself (review of gsd-core#2). The fake builder
// returns a marker so the test sees WHICH script name was re-derived, and the
// config dir decides which script directories are GSD's.
describe('[gsd-local] reconcileManagedChainCommandsToRunner: which commands it owns', () => {
  const hooksSurface = require('../gsd-core/bin/lib/runtime-hooks-surface.cjs');
  const ROOT = '/cfg/.claude';
  const PREFIX = '"$(for n in "/usr/bin/node" "$(command -v node)"; do [ -x "$n" ] && printf \'%s\' "$n" && break; done)" ';
  const build = (hookFile) => `RUNNER ${hookFile}`;
  const run = (command, extra = {}) => {
    const s = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command, ...extra }] }] } };
    const changed = hooksSurface.reconcileManagedChainCommandsToRunner(s, build, ROOT);
    return { changed, command: s.hooks.PreToolUse[0].hooks[0].command };
  };

  test('double-quoted managed script in the config hooks dir migrates (control)', () => {
    assert.deepEqual(run(PREFIX + `"${ROOT}/hooks/gsd-prompt-guard.js"`), { changed: true, command: 'RUNNER gsd-prompt-guard.js' });
  });

  test('single-quoted managed script migrates (upstream keeps legacy single quotes in the chain)', () => {
    assert.deepEqual(run(PREFIX + `'${ROOT}/hooks/gsd-prompt-guard.js'`), { changed: true, command: 'RUNNER gsd-prompt-guard.js' });
  });

  test('bare managed script migrates', () => {
    assert.deepEqual(run(PREFIX + `${ROOT}/hooks/gsd-prompt-guard.js`), { changed: true, command: 'RUNNER gsd-prompt-guard.js' });
  });

  test('a managed name in a FOREIGN directory is never pointed at GSD\'s copy', () => {
    for (const p of ['/home/u/own-tools/gsd-prompt-guard.js', '/opt/other-claude/hooks/gsd-read-guard.js', 'gsd-prompt-guard.js']) {
      const cmd = PREFIX + JSON.stringify(p);
      assert.deepEqual(run(cmd), { changed: false, command: cmd }, p);
    }
  });

  test('the $HOME form of the config hooks dir is GSD\'s too', () => {
    const os = require('node:os');
    const home = os.homedir();
    const cmd = PREFIX + `"$HOME/.claude/hooks/gsd-prompt-guard.js"`;
    const s = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: cmd }] }] } };
    assert.equal(hooksSurface.reconcileManagedChainCommandsToRunner(s, build, path.join(home, '.claude')), true);
    assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'RUNNER gsd-prompt-guard.js');
  });

  test('extra arguments after the script are never dropped', () => {
    const cmd = PREFIX + `"${ROOT}/hooks/gsd-prompt-guard.js" --strict`;
    assert.deepEqual(run(cmd), { changed: false, command: cmd });
  });

  test('the same dir spelled differently is still GSD\'s (trailing slash, //, ./)', () => {
    // Re-verify of gsd-core#2: exact string compare left all 14 on the chain
    // (fail-open) when a plain install ran with `--config-dir <root>/`.
    for (const [cfg, token] of [
      [ROOT + '/', `"${ROOT}/hooks/gsd-prompt-guard.js"`],
      [ROOT, `"${ROOT}//hooks/gsd-prompt-guard.js"`],
      [ROOT, `"${ROOT}/./hooks/gsd-prompt-guard.js"`],
    ]) {
      const s = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: PREFIX + token }] }] } };
      assert.equal(hooksSurface.reconcileManagedChainCommandsToRunner(s, build, cfg), true, `${cfg} ${token}`);
      assert.equal(s.hooks.PreToolUse[0].hooks[0].command, 'RUNNER gsd-prompt-guard.js');
    }
  });

  test('a symlinked config dir owns the real dir\'s scripts, both ways', (t) => {
    const base = createTempDir('gsd-local-portmig-link-');
    t.after(() => cleanup(base));
    const real = path.join(base, 'real');
    fs.mkdirSync(path.join(real, 'hooks'), { recursive: true });
    const link = path.join(base, 'link');
    fs.symlinkSync(real, link);
    for (const [cfg, dir] of [[link, real], [real, link]]) {
      const s = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: PREFIX + JSON.stringify(`${dir}/hooks/gsd-prompt-guard.js`) }] }] } };
      assert.equal(hooksSurface.reconcileManagedChainCommandsToRunner(s, build, cfg), true, `cfg=${cfg} script in ${dir}`);
    }
    const other = path.join(base, 'other');
    fs.mkdirSync(path.join(other, 'hooks'), { recursive: true });
    const cmd = PREFIX + JSON.stringify(`${other}/hooks/gsd-prompt-guard.js`);
    const s = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: cmd }] }] } };
    assert.equal(hooksSurface.reconcileManagedChainCommandsToRunner(s, build, link), false, 'control: a real OTHER dir stays foreign');
  });

  test('a relative token is never ours, even with the cwd inside the config hooks dir', () => {
    const base = createTempDir('gsd-local-portmig-rel-');
    const hooks = path.join(base, 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const cwd = process.cwd();
    let changed;
    try {
      process.chdir(hooks);
      const s = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: PREFIX + '"gsd-prompt-guard.js"' }] }] } };
      changed = hooksSurface.reconcileManagedChainCommandsToRunner(s, build, base);
      const c = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: PREFIX + JSON.stringify(path.join(hooks, 'gsd-prompt-guard.js')) }] }] } };
      assert.equal(hooksSurface.reconcileManagedChainCommandsToRunner(c, build, base), true, 'control: the absolute spelling of the same file is ours');
    } finally {
      process.chdir(cwd);
      cleanup(base);
    }
    assert.equal(changed, false);
  });

  test('an args-form entry is left alone', () => {
    const cmd = PREFIX + `"${ROOT}/hooks/gsd-prompt-guard.js"`;
    assert.deepEqual(run(cmd, { args: ['x'] }), { changed: false, command: cmd });
  });
});
