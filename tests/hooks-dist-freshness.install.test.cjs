'use strict';

/**
 * hooks/dist freshness — build side and install side.
 *
 * Measured defect: `scripts/build-hooks.js` only ever ADDED to `hooks/dist/`,
 * so a hook deleted or moved in source stayed in dist forever. The installer
 * then copied EVERY top-level file of `hooks/dist/` into the user's hooks dir.
 * Concretely, a stale `hooks/dist/gsd-find-project-root.sh` (the root finder
 * moved to `hooks/lib/`) overwrote a user-owned `hooks/gsd-find-project-root.sh`
 * in a test install. That file is never GSD-owned.
 *
 *   1. build: after a build, `hooks/dist/` is exactly the shipped set
 *      (HOOKS_TO_COPY + HOOKS_SUBDIRS_TO_COPY, and `dist/<subdir>` mirrors
 *      `hooks/<subdir>`). Stale entries are gone.
 *   2. install: the installer copies only what GSD ships (the same
 *      HOOKS_TO_COPY / HOOKS_SUBDIRS_TO_COPY lists that already drive the
 *      manifest), even when `hooks/dist/` holds a stray entry.
 */

process.env.GSD_TEST_MODE = '1';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runNode } = require('./helpers/process-seam.cjs');
const { cleanup } = require('./helpers.cjs');
const { installerEnv } = require('./helpers/install-shared.cjs');
const { buildOverlayRepo } = require('./helpers/overlay-repo.cjs');
const { ensureHooksDist } = require('./helpers/hooks-dist.cjs');
const { BUILD_TIMEOUT_MS, INSTALL_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { HOOKS_TO_COPY, HOOKS_SUBDIRS_TO_COPY, pruneStale } = require('../scripts/build-hooks.js');

const REPO_ROOT = path.resolve(__dirname, '..');

/** Copy build-hooks.js and the hooks/ SOURCES (never hooks/dist) into a scratch root. */
function stageBuildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dist-fresh-build-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', 'build-hooks.js'),
    path.join(root, 'scripts', 'build-hooks.js'),
  );
  fs.cpSync(path.join(REPO_ROOT, 'hooks'), path.join(root, 'hooks'), {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes('dist'),
  });
  return root;
}

describe('build-hooks: hooks/dist exactly reflects current sources', () => {
  let root;
  before(() => { root = stageBuildFixture(); });
  after(() => { cleanup(root); });

  test('stale top-level and subdir entries are removed by a build', () => {
    const dist = path.join(root, 'hooks', 'dist');
    fs.mkdirSync(path.join(dist, 'lib'), { recursive: true });
    // The measured stale entry, plus one stale entry inside a shipped subdir
    // and one stale directory that no source names.
    fs.writeFileSync(path.join(dist, 'gsd-find-project-root.sh'), '# stale\n');
    fs.writeFileSync(path.join(dist, 'lib', 'gsd-removed-helper.js'), '// stale\n');
    fs.mkdirSync(path.join(dist, 'gone-subdir'));
    fs.writeFileSync(path.join(dist, 'gone-subdir', 'x.js'), '// stale\n');

    const result = runNode([path.join(root, 'scripts', 'build-hooks.js')], {
      cwd: root,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    assert.equal(result.exitCode, 0, `build failed: ${result.stderr}`);

    const top = fs.readdirSync(dist).sort();
    const expectedTop = [...HOOKS_TO_COPY, ...HOOKS_SUBDIRS_TO_COPY].sort();
    assert.deepEqual(top, expectedTop, 'hooks/dist top level must be exactly the shipped set');

    for (const sub of HOOKS_SUBDIRS_TO_COPY) {
      const srcFiles = fs.readdirSync(path.join(root, 'hooks', sub), { withFileTypes: true })
        .filter((e) => e.isFile()).map((e) => e.name).sort();
      assert.ok(srcFiles.length > 0, `control: hooks/${sub} has source files`);
      assert.deepEqual(fs.readdirSync(path.join(dist, sub)).sort(), srcFiles,
        `hooks/dist/${sub} must mirror hooks/${sub}`);
    }
  });
});

describe('installer: copies only hooks GSD ships, never a stray dist entry', () => {
  let overlay;
  let configDir;
  before(() => {
    ensureHooksDist();
    overlay = buildOverlayRepo({});
    // A NEW path in the overlay's real hooks/dist dir (not a hard-linked leaf),
    // so the real checkout is untouched.
    fs.writeFileSync(path.join(overlay, 'hooks', 'dist', 'gsd-find-project-root.sh'), '# STALE DIST COPY\n');
    fs.mkdirSync(path.join(overlay, 'hooks', 'dist', 'gone-subdir'));
    fs.writeFileSync(path.join(overlay, 'hooks', 'dist', 'gone-subdir', 'x.js'), '// stale\n');
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dist-fresh-install-'));
    fs.mkdirSync(path.join(configDir, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'hooks', 'gsd-find-project-root.sh'), '# USER OWNED\n');
  });
  after(() => {
    if (overlay) cleanup(overlay);
    if (configDir) cleanup(configDir);
  });

  test('user-owned hooks/gsd-find-project-root.sh survives install; shipped hooks land', () => {
    const result = runNode([
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      path.join(overlay, 'bin', 'install.js'),
      '--claude',
      '--global',
      '--config-dir',
      configDir,
    ], {
      cwd: configDir,
      // The first-install baseline scan flags a gsd-* file it cannot prove
      // manifest-managed; the user's answer for this file is "keep" (it is
      // user-owned), which is exactly the case under test.
      env: installerEnv({
        HOME: configDir,
        USERPROFILE: configDir,
        GSD_INSTALLER_MIGRATION_RESOLVE: 'keep',
      }),
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    assert.equal(result.exitCode, 0, `install failed: ${result.stderr}`);

    // Positive control: the copy loop ran and delivered shipped hooks.
    for (const hook of HOOKS_TO_COPY) {
      assert.ok(fs.existsSync(path.join(configDir, 'hooks', hook)), `${hook} should be installed`);
    }
    assert.equal(
      fs.readFileSync(path.join(configDir, 'hooks', 'gsd-find-project-root.sh'), 'utf8'),
      '# USER OWNED\n',
      'installer must not overwrite a user file with a stray hooks/dist entry',
    );
    assert.ok(fs.existsSync(path.join(configDir, 'hooks', 'lib')), 'control: shipped subdir lib/ is installed');
    assert.ok(!fs.existsSync(path.join(configDir, 'hooks', 'gone-subdir')),
      'installer must not copy a hooks/dist subdir GSD does not ship');
  });
});

describe('build-hooks: a listed hook whose source is gone leaves no dist copy', () => {
  let root;
  before(() => { root = stageBuildFixture(); });
  after(() => { cleanup(root); });

  test('dist/<hook> is removed when hooks/<hook> no longer exists', () => {
    const victim = HOOKS_TO_COPY.find((h) => h.endsWith('.js'));
    const dist = path.join(root, 'hooks', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, victim), '// stale copy of a deleted source\n');
    fs.unlinkSync(path.join(root, 'hooks', victim));

    const result = runNode([path.join(root, 'scripts', 'build-hooks.js')], {
      cwd: root,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    assert.equal(result.exitCode, 0, `build failed: ${result.stderr}`);
    assert.ok(!fs.existsSync(path.join(dist, victim)), `stale dist/${victim} must not survive its source`);
    // Positive control: the other listed hooks were built.
    const others = HOOKS_TO_COPY.filter((h) => h !== victim);
    for (const h of others) assert.ok(fs.existsSync(path.join(dist, h)), `${h} should be built`);
  });
});

describe('build-hooks: pruning is best-effort, never fails the build', () => {
  let root;
  let locked;
  before(() => { root = stageBuildFixture(); });
  after(() => {
    if (locked) fs.chmodSync(locked, 0o755);
    cleanup(root);
  });

  test('an unremovable stale entry warns and the build still exits 0', (t) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      t.skip('needs a POSIX non-root user for a permission-denied rm');
      return;
    }
    const dist = path.join(root, 'hooks', 'dist');
    locked = path.join(dist, 'stale-locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'x.js'), '// stale\n');
    fs.chmodSync(locked, 0o555);

    const result = runNode([path.join(root, 'scripts', 'build-hooks.js')], {
      cwd: root,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    assert.equal(result.exitCode, 0, `build must not fail on a prune error: ${result.stderr}`);
    // Control: the rm really was refused, so the arm exercised the error path.
    assert.ok(fs.existsSync(path.join(locked, 'x.js')), 'control: the locked stale file is still there');
    assert.match(result.stdout + result.stderr, /could not remove stale stale-locked/, 'the failed prune is reported');
  });
});

/** True when `dir` can hold `a` and `A` as two different entries. */
function caseSensitive(dir) {
  const name = `case-probe-${process.pid}`;
  const probe = path.join(dir, name);
  fs.writeFileSync(probe, '');
  try {
    return !fs.existsSync(path.join(dir, name.toUpperCase()));
  } finally {
    fs.unlinkSync(probe);
  }
}

describe('build-hooks: prune keeps a case-only alias of a shipped file', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dist-fresh-case-')); });
  after(() => { cleanup(dir); });

  // On a case-insensitive FS (macOS/Windows) a hook renamed only by case can
  // still be listed under its old-case name after the build writes it, and
  // that name IS the shipped file. Simulated here with a same-inode alias.
  test('same-inode case variant survives; a distinct stale file is removed', (t) => {
    if (!caseSensitive(dir)) {
      t.skip('needs a case-sensitive FS to hold two case variants side by side');
      return;
    }
    fs.writeFileSync(path.join(dir, 'gsd-hook.js'), '// shipped\n');
    fs.linkSync(path.join(dir, 'gsd-hook.js'), path.join(dir, 'GSD-Hook.js'));
    // Twin exists as a separate file, so the inode comparison really runs.
    fs.writeFileSync(path.join(dir, 'gsd-other.js'), '// shipped\n');
    fs.writeFileSync(path.join(dir, 'Gsd-Other.js'), '// stale, different file\n');

    pruneStale(dir, new Set(['gsd-hook.js', 'gsd-other.js']));

    assert.ok(fs.existsSync(path.join(dir, 'GSD-Hook.js')), 'case-only alias of the shipped file must not be pruned');
    // Control: a case variant that is a DIFFERENT file is still stale.
    assert.ok(!fs.existsSync(path.join(dir, 'Gsd-Other.js')), 'a different-inode case variant is pruned');
    assert.ok(fs.existsSync(path.join(dir, 'gsd-hook.js')), 'control: the shipped file is intact');
  });
});

describe('build-hooks: a stale listed entry that is a directory', () => {
  let root;
  before(() => { root = stageBuildFixture(); });
  after(() => { cleanup(root); });

  test('dist/<hook> as a directory with no source is removed and the build exits 0', () => {
    const victim = HOOKS_TO_COPY.find((h) => h.endsWith('.js'));
    const dist = path.join(root, 'hooks', 'dist');
    fs.mkdirSync(path.join(dist, victim), { recursive: true });
    fs.writeFileSync(path.join(dist, victim, 'x'), 'stale\n');
    fs.unlinkSync(path.join(root, 'hooks', victim));

    const result = runNode([path.join(root, 'scripts', 'build-hooks.js')], {
      cwd: root,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    assert.equal(result.exitCode, 0, `build must not fail on a stale directory: ${result.stderr}`);
    assert.ok(!fs.existsSync(path.join(dist, victim)), `stale dist/${victim}/ must not survive its source`);
    const others = HOOKS_TO_COPY.filter((h) => h !== victim);
    for (const h of others) assert.ok(fs.existsSync(path.join(dist, h)), `control: ${h} should be built`);
  });
});

describe('build-hooks: symlinks in dist are judged by the link, not the target', () => {
  let dir;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dist-fresh-link-')); });
  after(() => { cleanup(dir); });

  test('a dangling stray symlink and a symlink case variant are pruned', (t) => {
    if (process.platform === 'win32') {
      t.skip('symlink creation needs privileges on Windows');
      return;
    }
    fs.writeFileSync(path.join(dir, 'gsd-hook.js'), '// shipped\n');
    fs.symlinkSync(path.join(dir, 'nowhere.js'), path.join(dir, 'dangling.js'));
    fs.symlinkSync(path.join(dir, 'gsd-hook.js'), path.join(dir, 'GSD-HOOK-LINK.js'));
    // Case variant that is a symlink to the shipped file: an alias made by
    // hand, not the case-insensitive-FS view of the file itself.
    let variant = null;
    if (caseSensitive(dir)) {
      variant = path.join(dir, 'GSD-Hook.js');
      fs.symlinkSync(path.join(dir, 'gsd-hook.js'), variant);
    }

    pruneStale(dir, new Set(['gsd-hook.js']));

    const has = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
    assert.ok(!has(path.join(dir, 'dangling.js')), 'a dangling stray symlink must be pruned');
    assert.ok(!has(path.join(dir, 'GSD-HOOK-LINK.js')), 'control: a stray symlink to a shipped file is pruned');
    if (variant) assert.ok(!has(variant), 'a symlink case variant is not the shipped file and must be pruned');
    assert.ok(fs.existsSync(path.join(dir, 'gsd-hook.js')), 'control: the shipped file is intact');
  });
});
