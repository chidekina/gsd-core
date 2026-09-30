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
