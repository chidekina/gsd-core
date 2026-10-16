const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('pause-work improvements', () => {
  let pauseContent;

  test('pause-work.md exists', () => {
    const p = path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md');
    assert.ok(fs.existsSync(p));
    pauseContent = fs.readFileSync(p, 'utf-8');
  });

  test('#1489: pause-work detects non-phase contexts (spike, deliberation, research)', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(pauseContent.includes('spike') || pauseContent.includes('Spike'),
      'pause-work should handle spike context');
    assert.ok(pauseContent.includes('deliberation') || pauseContent.includes('research'),
      'pause-work should handle deliberation/research context');
  });

  test('#1489: pause-work writes to non-phase paths when appropriate', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(pauseContent.includes('.planning/.continue-here') ||
              pauseContent.includes('.planning/spikes') ||
              pauseContent.includes('non-phase'),
      'pause-work should write to root .planning/ when not in a phase');
  });

  test('#1490: continue-here template includes required-reading section', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(pauseContent.includes('Required Reading') || pauseContent.includes('required-reading'),
      'Template should include Required Reading section');
  });

  test('#1490: continue-here template includes anti-patterns section', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(pauseContent.includes('Anti-Pattern') || pauseContent.includes('anti-pattern') ||
              pauseContent.includes('do NOT repeat'),
      'Template should include Anti-Patterns section');
  });

  test('#1490: continue-here template includes infrastructure-state section', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(pauseContent.includes('Infrastructure') || pauseContent.includes('infrastructure'),
      'Template should include Infrastructure State section');
  });

  test('#1487: pause-work documents pre-execution critique gate', () => {
    pauseContent = pauseContent || fs.readFileSync(
      path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md'), 'utf-8'
    );
    assert.ok(
      pauseContent.includes('critique') || pauseContent.includes('design gate') ||
      pauseContent.includes('Pre-Execution'),
      'pause-work should document design critique gate for design→execution transitions'
    );
  });
});


// ────────────────────────────────────────────────────────────────────────
// Folded from tests/bug-3446-resume-continue-here-discovery.test.cjs — consolidation epic #1969 (B6 #1975)
// ────────────────────────────────────────────────────────────────────────
{
  const { describe: __foldDescribe } = require('node:test');
  __foldDescribe("folded:bug-3446-resume-continue-here-discovery (consolidation epic #1969 B6 #1975)", () => {
// allow-test-rule: source-text-is-the-product (see #3446)
// Workflow `.md` files are the runtime contract executed by Claude Code as
// embedded bash. This test extracts the actual `check_incomplete_work` bash
// block from resume-project.md and exercises it against a planted directory
// layout — that's a behavioral integration test of the workflow contract,
// not regex-on-source.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runHook: runHookSeam } = require('./helpers/process-seam.cjs');
const { toLegacyResult } = require('./helpers/git-fixture.cjs');
const { createTempDir, cleanup, readFileNormalized } = require('./helpers.cjs');
const { scanFencedBlocks } = require('../gsd-core/bin/lib/markdown-sectionizer.cjs');

const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'resume-project.md');

// Extract the first ```bash``` code block inside the
// `<step name="check_incomplete_work">` element. That's the snippet the
// runtime actually executes; it's what we want to validate.
//
// readFileNormalized() strips \r\n -> \n before the fence match below runs —
// the extracted snippet is spawned via spawnSync('bash', ...) in
// runSnippet(), so an un-normalized read on a Windows checkout would break
// bash mid-script (DEFECT.TEST-SHELL-PIPELINE-NONPORTABLE, #2650).
function extractCheckBlock() {
  const md = readFileNormalized(WORKFLOW_PATH);
  const stepStart = md.indexOf('<step name="check_incomplete_work">');
  assert.ok(stepStart >= 0, 'resume-project.md must contain a check_incomplete_work step');
  const stepEnd = md.indexOf('</step>', stepStart);
  assert.ok(
    stepEnd >= 0,
    'check_incomplete_work step must have a closing </step> tag',
  );
  const stepBody = md.slice(stepStart, stepEnd);
  const stepLines = stepBody.split('\n');
  for (const block of scanFencedBlocks(stepLines)) {
    if (block.closeLineIdx === -1) continue;
    const info = (block.infoString || '').trim();
    if (info !== 'bash' && info !== 'sh') continue;
    return stepLines.slice(block.openLineIdx + 1, block.closeLineIdx).join('\n');
  }
  assert.fail('check_incomplete_work step must embed a ```bash code block');
}

function runSnippet(cwd, snippet) {
  // has_interrupted_agent is a downstream-orchestrator variable; default it
  // to "false" so the embedded `if` branch is a no-op during this test.
  return toLegacyResult(runHookSeam('-c', [snippet], {
    interpreter: 'bash',
    cwd,
    env: { ...process.env, has_interrupted_agent: 'false', interrupted_agent_id: '' },
  }));
}

describe('bug #3446: resume-project detects non-phase and legacy continue-here handoffs', () => {
  let tmpDir;
  let snippet;

  before(() => {
    snippet = extractCheckBlock();
    tmpDir = createTempDir('gsd-bug-3446-');

    // Plant the three discovery surfaces that bug #3446 was originally
    // filed to cover.
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', '.continue-here.md'),
      '---\ncontext: default\n---\nroot-of-.planning handoff\n',
      'utf8',
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'sketches', 'SKETCH-001'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'sketches', 'SKETCH-001', '.continue-here.md'),
      '---\ncontext: sketch\n---\nsketch handoff\n',
      'utf8',
    );

    fs.writeFileSync(
      path.join(tmpDir, '.continue-here.md'),
      '---\ncontext: legacy\n---\nlegacy repo-root handoff\n',
      'utf8',
    );
  });

  after(() => {
    cleanup(tmpDir);
  });

  test('check_incomplete_work surfaces .planning/.continue-here.md (depth 1 under .planning)', () => {
    const result = runSnippet(tmpDir, snippet);
    assert.equal(result.status, 0, `snippet exited ${result.status}; stderr=${result.stderr}`);
    assert.match(
      result.stdout,
      /\.planning\/\.continue-here\.md/,
      `expected .planning/.continue-here.md in stdout; got: ${JSON.stringify(result.stdout)}`,
    );
  });

  test('check_incomplete_work surfaces .planning/sketches/SKETCH-001/.continue-here.md (depth 3 under .planning)', () => {
    const result = runSnippet(tmpDir, snippet);
    assert.equal(result.status, 0, `snippet exited ${result.status}; stderr=${result.stderr}`);
    assert.match(
      result.stdout,
      /\.planning\/sketches\/SKETCH-001\/\.continue-here\.md/,
      `expected sketch handoff in stdout; got: ${JSON.stringify(result.stdout)}`,
    );
  });

  test('check_incomplete_work surfaces legacy repo-root .continue-here.md', () => {
    const result = runSnippet(tmpDir, snippet);
    assert.equal(result.status, 0, `snippet exited ${result.status}; stderr=${result.stderr}`);
    assert.match(
      result.stdout,
      /(^|\n)\.\/\.continue-here\.md(\n|$)/,
      `expected legacy ./.continue-here.md in stdout; got: ${JSON.stringify(result.stdout)}`,
    );
  });
});
  });
}


// ────────────────────────────────────────────────────────────────────────
// Folded from tests/bug-3689-resume-glob-nomatch.test.cjs — consolidation epic #1969 (B6 #1975)
// ────────────────────────────────────────────────────────────────────────
{
  const { describe: __foldDescribe } = require('node:test');
  __foldDescribe("folded:bug-3689-resume-glob-nomatch (consolidation epic #1969 B6 #1975)", () => {
// allow-test-rule: source-text-is-the-product (see #3689)
// Workflow `.md` files are the runtime contract executed by Claude Code as
// embedded bash. Asserting on the staged text of resume-project.md and on the
// behavior of the embedded snippet under real shells is a behavioral test of
// the workflow itself, not source-grep theater.

/**
 * Regression for #3689 — /gsd-resume-work silently drops
 * `.planning/.continue-here*.md` checkpoints under zsh's default NOMATCH.
 *
 * Root cause: the `check_incomplete_work` step in
 * `gsd-core/workflows/resume-project.md` used a chained `ls` with six
 * bare-glob arguments. Under zsh's default `NOMATCH` setopt the first
 * non-matching glob aborts the entire command during word-expansion — every
 * pattern after that point is never evaluated, including the one that holds
 * valid pause checkpoints (`.planning/.continue-here*.md`). `2>/dev/null ||
 * true` only suppresses ls's own stderr / exit code; it has no effect on the
 * shell's pre-exec abort.
 *
 * Fix: replace the chained `ls` with two `find` calls. `find` does not use
 * shell glob expansion, and `find <missing-dir> -maxdepth N -name PATTERN
 * -print 2>/dev/null` tolerates absent directories on both bash and zsh.
 *
 * This test covers:
 *   1. zsh under `-o nomatch`: checkpoint at `.planning/.continue-here-*.md`
 *      is listed even when `.planning/spikes`, `.planning/sketches`,
 *      `.planning/deliberations` are absent (the common new-project layout).
 *   2. bash default: same behavior.
 *   3. zsh `-o nomatch` with no `.continue-here` files anywhere: exits 0,
 *      no output, no error.
 *   4. Text invariant: resume-project.md no longer carries the brittle
 *      chained-ls pattern.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runHook: runHookSeam } = require('./helpers/process-seam.cjs');
const { toLegacyResult } = require('./helpers/git-fixture.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'gsd-core', 'workflows', 'resume-project.md');

// The exact snippet the workflow now embeds. Keep in sync with
// resume-project.md `check_incomplete_work` step.
const FIND_SNIPPET = [
  "find .planning -maxdepth 3 -name '.continue-here*.md' -print 2>/dev/null || true",
  "find . -maxdepth 1 -name '.continue-here*.md' -print 2>/dev/null || true",
].join('\n');

function hasShell(name) {
  const result = toLegacyResult(runHookSeam(name, [], { interpreter: 'which' }));
  return result.status === 0 && result.stdout.trim().length > 0;
}

describe('bug #3689 — resume-project.md continue-here scan under zsh NOMATCH', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempDir('gsd-bug-3689-');
    // Reproduce the common new-project layout: a `.planning/` with a
    // suffixed continue-here file and *no* spike / sketch / deliberation
    // subdirectories.
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', '.continue-here-AT-1234.md'),
      '---\ncontext: default\n---\nhandoff body\n',
      'utf8',
    );
  });

  after(() => {
    cleanup(tmpDir);
  });

  test('zsh -o nomatch lists the .planning/.continue-here-* checkpoint', { skip: !hasShell('zsh') }, () => {
    const result = toLegacyResult(runHookSeam('-o', ['nomatch', '-c', FIND_SNIPPET], {
      interpreter: 'zsh',
      cwd: tmpDir,
    }));
    assert.equal(result.status, 0, `zsh exited ${result.status}; stderr=${result.stderr}`);
    assert.match(
      result.stdout,
      /\.planning\/\.continue-here-AT-1234\.md/,
      `expected checkpoint in stdout, got: ${JSON.stringify(result.stdout)}`,
    );
  });

  test('bash default lists the .planning/.continue-here-* checkpoint', { skip: !hasShell('bash') }, () => {
    const result = toLegacyResult(runHookSeam('-c', [FIND_SNIPPET], {
      interpreter: 'bash',
      cwd: tmpDir,
    }));
    assert.equal(result.status, 0, `bash exited ${result.status}; stderr=${result.stderr}`);
    assert.match(
      result.stdout,
      /\.planning\/\.continue-here-AT-1234\.md/,
      `expected checkpoint in stdout, got: ${JSON.stringify(result.stdout)}`,
    );
  });
});

describe('bug #3689 — empty workspace exits cleanly', () => {
  let tmpDir;

  before(() => {
    tmpDir = createTempDir('gsd-bug-3689-');
    // No .planning/ at all, no .continue-here files. Pure greenfield.
  });

  after(() => {
    cleanup(tmpDir);
  });

  test('zsh -o nomatch with no checkpoints exits 0, empty output', { skip: !hasShell('zsh') }, () => {
    const result = toLegacyResult(runHookSeam('-o', ['nomatch', '-c', FIND_SNIPPET], {
      interpreter: 'zsh',
      cwd: tmpDir,
    }));
    assert.equal(result.status, 0, `zsh exited ${result.status}; stderr=${result.stderr}`);
    assert.equal(result.stdout.trim(), '', `expected no stdout, got: ${JSON.stringify(result.stdout)}`);
  });
});

describe('bug #3689 — workflow text invariant', () => {
  test('resume-project.md no longer chains bare globs through ls', () => {
    const body = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    assert.doesNotMatch(
      body,
      /ls\s+\.planning\/spikes\/\*\/\.continue-here/,
      'resume-project.md still contains the chained `ls .planning/spikes/*/.continue-here*.md` pattern that aborts under zsh NOMATCH; the find-based scan should replace it.',
    );
    assert.match(
      body,
      /find \.planning -maxdepth 3 -name '\.continue-here\*\.md'/,
      'resume-project.md must use the find-based scan introduced by the #3689 fix.',
    );
  });
});
  });
}

describe('pause-work infra snapshot beyond SSH VPS', () => {
  const p = path.join(__dirname, '..', 'gsd-core', 'workflows', 'pause-work.md');
  const block = () => {
    const t = fs.readFileSync(p, 'utf-8');
    const m = t.match(/<!-- vps-sync-start -->([\s\S]*?)<!-- vps-sync-end -->/);
    assert.ok(m, 'vps-sync block must exist');
    return m[1];
  };

  // Every `aws lightsail ...` command, checked one by one and STRUCTURALLY (review of PR #10, rounds 1-2):
  // a lexical key whitelist let `containerServices[0]`, `...currentDeployment`, `.*` and `@` through, and
  // each of those prints the container environment. A query is accepted only as one of the shapes below,
  // with every selected value a scalar leaf path from the allow-list. The verb is allow-listed too.
  const VERBS = new Set(['get-container-services', 'get-relational-databases']);
  const LEAVES = {
    'containerServices[0]': new Set(['state', 'currentDeployment.version', 'currentDeployment.state', 'currentDeployment.containers.*.image|[0]']),
    'relationalDatabases[]': new Set(['name', 'state', 'backupRetentionEnabled']),
  };
  const LIST_QUERY = 'containerServices[].containerServiceName';
  function queryProblem(q) {
    if (q === LIST_QUERY) return null;
    const m = q.match(/^(containerServices\[0\]|relationalDatabases\[\])\.\{(.+)\}$/);
    if (!m) return `shape not allowed: ${q}`;
    for (const pair of m[2].split(',')) {
      const kv = pair.match(/^([A-Za-z]+):(.+)$/);
      if (!kv) return `bad pair ${pair}`;
      if (!LEAVES[m[1]].has(kv[2])) return `value not a leaf: ${kv[2]}`;
    }
    return null;
  }
  function awsCallProblems(text) {
    const calls = [...text.matchAll(/`(aws lightsail [^`]+)`/g)].map(m => m[1]);
    const problems = [];
    // a call outside an inline span (fenced block, double space) would escape the per-call check
    const mentions = (text.match(/aws\s+lightsail\s/g) || []).length;
    if (mentions !== calls.length) problems.push(`${mentions} aws lightsail mentions, ${calls.length} checked spans`);
    for (const c of calls) {
      const verb = c.split(/\s+/)[2];
      if (!VERBS.has(verb)) problems.push(`verb not allowed: ${verb}`);
      if (/--debug/.test(c)) problems.push(`--debug: ${c}`);
      if (!/--region /.test(c)) problems.push(`no --region: ${c}`);
      const qs = [...c.matchAll(/--query\b/g)].length;
      if (qs > 1) problems.push(`${qs} --query flags (only the first would be checked): ${c}`);
      const q = c.match(/--query '([^']+)'/);
      if (!q) { problems.push(`no --query: ${c}`); continue; }
      const why = queryProblem(q[1]);
      if (why) problems.push(why);
    }
    return { calls, problems };
  }

  // match-co 2026-10-16: prod on AWS Lightsail Container Service (no SSH) was "skipped silently" as if
  // the project had no infrastructure.
  test('handles AWS Lightsail with every call scoped, regioned and query-limited', () => {
    const { calls, problems } = awsCallProblems(block());
    assert.ok(calls.filter(c => /get-container-services/.test(c)).length >= 2, `expected list + per-service calls, got ${calls.length}`);
    assert.ok(calls.some(c => /get-relational-databases/.test(c)), 'databases are part of the snapshot');
    assert.deepEqual(problems, []);
  });

  // CONTROL: the checker must fail the shapes that leak, or a green above measures nothing.
  test('the call checker rejects each leaking shape', () => {
    const forged = [
      "`aws lightsail get-container-services --region us-east-1 --service-name x`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].currentDeployment.containers'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].currentDeployment.containers.*.environment'`",
      "`aws lightsail get-container-log --region us-east-1 --query 'logEvents'`",
      "`aws lightsail get-container-services --query 'containerServices[].containerServiceName'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0]'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].currentDeployment'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].currentDeployment.*'`",
      "`aws lightsail get-container-services --region us-east-1 --query '@'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].{img:currentDeployment}'`",
      "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].{s:state}' --query 'containerServices[0]'`",
      "`aws lightsail get-relational-database-master-user-password --region us-east-1 --query 'masterUserPassword'`",
      "```\naws lightsail get-container-services --region us-east-1\n```",
    ];
    for (const f of forged) assert.ok(awsCallProblems(f).problems.length > 0, `should reject: ${f}`);
    const ok = "`aws lightsail get-container-services --region us-east-1 --query 'containerServices[0].{estado:state,img:currentDeployment.containers.*.image|[0]}' --output json`";
    assert.deepEqual(awsCallProblems(ok).problems, []);
  });

  test('the block forbids the env-leaking neighbours and the retry without --query', () => {
    const b = block();
    assert.match(b, /never call `get-container-service-deployments`/i);
    assert.match(b, /never add `--debug`/i);
    assert.match(b, /do not rerun it without `--query`/i);
  });

  test('the managed check runs even when the SSH branch skipped (Check B can match "no VPS")', () => {
    const b = block();
    assert.match(b, /independently of the VPS result/i);
    assert.equal((b.match(/snapshot skipped[^\n]*` and go to the managed-platform check below\./g) || []).length, 2, 'both SSH skips hand over to the managed check');
    assert.doesNotMatch(b, /` and skip\./, 'SSH skips must hand over to the managed check');
    assert.doesNotMatch(b, /skip the entire block silently/i);
  });

  test('detection, missing CLI, region and the empty case are each reported', () => {
    const b = block();
    for (const root of ['docs', 'CLAUDE.md', 'AGENTS.md', 'README.md', 'scripts', 'infra', '.github', '.planning/PROJECT.md']) assert.ok(b.includes(`$PROJECT_ROOT/${root}`), `detection scans ${root}`);
    assert.match(b, /command -v aws/);
    assert.match(b, /but aws CLI not found — snapshot skipped/);
    assert.match(b, /AWS_REGION/);
    assert.match(b, /none detected by keyword search/);
    assert.match(b, /if EVERY grepped name was not found, fall back to the account listing/);
    assert.match(b, /databases \(account, region <region>\)/);
  });
});
