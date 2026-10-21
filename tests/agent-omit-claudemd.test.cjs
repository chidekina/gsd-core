'use strict';

process.env.GSD_TEST_MODE = '1';

// allow-test-rule: source-text-is-the-product — agent frontmatter is loaded by the runtime.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { runMinimalInstall, RUNTIME_META, BUILD_SCRIPT } = require('./helpers/install-shared.cjs');
const { runNode } = require('./helpers/process-seam.cjs');
const { throwIfFailed } = require('./helpers/git-fixture.cjs');
const { BUILD_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const conversion = require('../gsd-core/bin/lib/runtime-artifact-conversion.cjs');
const installer = require('../bin/install.js');

const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const OMIT_AGENTS = [
  'gsd-doc-classifier',
  'gsd-doc-verifier',
  'gsd-research-synthesizer',
  'gsd-user-profiler',
];
const OMIT_FILES = OMIT_AGENTS.flatMap(name => [`${name}.md`, `${name}.compact.md`]).sort();

before(() => {
  throwIfFailed(runNode([BUILD_SCRIPT], { timeoutMs: BUILD_TIMEOUT_MS }), 'build installable hooks');
});

test('exactly the four self-contained agents opt out of CLAUDE.md in full and compact variants', () => {
  const optedOut = fs.readdirSync(AGENTS_DIR).filter(file => file.endsWith('.md')).filter(file => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    const frontmatter = content.split('---')[1] || '';
    if (!/^omitClaudeMd:/m.test(frontmatter)) return false;
    assert.match(frontmatter, /^omitClaudeMd: true$/m, `${file} must opt out explicitly`);
    return true;
  }).sort();
  assert.deepEqual(optedOut, OMIT_FILES);
});

test('Claude install preserves omitClaudeMd on the four canonical agents', t => {
  const root = createTempDir('gsd-omit-claude-');
  t.after(() => cleanup(root));
  const { configDir } = runMinimalInstall({ runtime: 'claude', scope: 'global', root });
  for (const agent of OMIT_AGENTS) {
    const content = fs.readFileSync(path.join(configDir, 'agents', `${agent}.md`), 'utf8');
    assert.match(content.split('---')[1], /^omitClaudeMd: true$/m, agent);
  }
});

// Synthetic input makes the negative tests meaningful before the source agents opt in.
const SOURCE = '---\nname: gsd-doc-classifier\ndescription: Classifies documents.\ntools: Read\ncolor: yellow\nomitClaudeMd: true\n---\n\nClassify the document.\n';
const CONVERTERS = [
  'convertClaudeToOpencodeFrontmatter',
  'convertClaudeToKiloFrontmatter',
  'convertClaudeAgentToCopilotAgent',
  'convertClaudeAgentToAntigravityAgent',
  'convertClaudeAgentToCursorAgent',
  'convertClaudeAgentToWindsurfAgent',
  'convertClaudeAgentToAugmentAgent',
  'convertClaudeAgentToTraeAgent',
  'convertClaudeAgentToCodebuddyAgent',
  'convertClaudeAgentToClineAgent',
  'convertClaudeAgentToCodexAgent',
  'convertClaudeAgentToHermesAgent',
  'convertClaudeAgentToQwenAgent',
  'convertClaudeAgentToZcodeAgent',
];

for (const name of CONVERTERS) {
  test(`${name} drops the Claude-only omitClaudeMd key`, () => {
    const output = conversion[name](SOURCE, name.startsWith('convertClaudeTo') ? { isAgent: true } : false);
    assert.doesNotMatch(output, /omitClaudeMd/);
    assert.match(output, /gsd-doc-classifier/, 'conversion must retain the agent identity');
    assert.match(output, /Classify the document\./, 'conversion must retain the prompt');
  });
}

for (const runtime of Object.keys(RUNTIME_META).filter(name => name !== 'claude')) {
  test(`${runtime} frontmatter pipeline strips omitClaudeMd while preserving body references`, () => {
    const output = conversion.applyAgentFrontmatterExtensions(`${SOURCE}\nomitClaudeMd: body example\n`, {
      runtime,
      agentName: 'gsd-doc-classifier',
      targetDir: null,
    });
    assert.doesNotMatch(output.split('---')[1], /omitClaudeMd/);
    assert.match(output, /omitClaudeMd: body example/, 'body text must survive');
  });
}

for (const name of ['convertClaudeToOpencodeFrontmatter', 'convertClaudeToKiloFrontmatter']) {
  test(`installer ${name} drops omitClaudeMd too`, () => {
    const output = installer[name](SOURCE, { isAgent: true });
    assert.doesNotMatch(output, /omitClaudeMd/);
    assert.match(output, /Classify the document\./);
  });
}

test('Kimi agent YAML and prompt omit Claude-only frontmatter', () => {
  const result = installer.buildKimiAgentArtifacts({
    rootAgent: SOURCE,
    subagents: [],
    requestedSubagents: [],
  });
  assert.doesNotMatch(result.root.yaml, /omitClaudeMd/);
  assert.doesNotMatch(result.root.prompt, /omitClaudeMd/);
  assert.match(result.root.prompt, /Classify the document\./, 'prompt must retain the body');
});

// Frontmatter edge cases for the pass-through strip (hermes routes through it).
const EDGE_SOURCES = {
  'a --- inside a value before the key': '---\nname: gsd-doc-classifier\ndescription: before --- after\nomitClaudeMd: true\n---\n\nClassify the document.\n',
  'a BOM before the opening fence': '\uFEFF---\nname: gsd-doc-classifier\nomitClaudeMd: true\n---\n\nClassify the document.\n',
  'trailing spaces on the closing fence': '---\nname: gsd-doc-classifier\nomitClaudeMd: true\n--- \n\nClassify the document.\n',
  'CRLF line endings': '---\r\nname: gsd-doc-classifier\r\nomitClaudeMd: true\r\n---\r\n\r\nClassify the document.\r\n',
};
for (const [label, source] of Object.entries(EDGE_SOURCES)) {
  test(`hermes strip handles ${label}`, () => {
    const output = conversion.convertClaudeAgentToHermesAgent(source);
    assert.doesNotMatch(output, /omitClaudeMd/);
    assert.match(output, /name: gsd-doc-classifier/);
    assert.match(output, /Classify the document\./);
  });
}

for (const runtime of ['opencode', 'kilo', 'kimi-code', 'hermes']) {
  test(`${runtime} install strips omitClaudeMd from full and compact agents`, t => {
    const root = createTempDir(`gsd-omit-${runtime}-`);
    t.after(() => cleanup(root));
    const { configDir } = runMinimalInstall({ runtime, scope: 'global', root });
    const agentsDir = path.join(configDir, 'agents');
    for (const file of OMIT_FILES) {
      const output = fs.readFileSync(path.join(agentsDir, file), 'utf8');
      assert.doesNotMatch(output, /omitClaudeMd/, file);
      assert.match(output, /^name:/m, `${file} retains its frontmatter`);
    }
  });
}
