'use strict';
// [gsd-local] One predicate for "this shell line calls a bare `node`", shared by the
// tests that pin the fork's .sh hooks to hooks/gsd-node-runner.sh (gsd-core#3 review,
// NIT-1/NIT-b). Command position only — line start, `$(`, a pipe or list operator,
// optionally after VAR=value assignments — followed by an argument node would run:
// -e/-p/--eval/--input-type, a quoted script, a variable, or a script path. Prose such as
// "no node could be resolved" and names such as gsd_node never match. Comment lines
// are the caller's job to drop. `bareNodeLines` also skips matches that sit inside a quoted
// string literal (prose such as `echo "if node is absent"`), but still flags a node inside a
// `$(...)` or backtick substitution opened within a string, since that executes.
// Prefixes widened after the second re-review (LOW-2): backticks, `!`, the compound-command
// keywords, the exec/env/command/time wrappers, quoted assignment values, and an unquoted
// script path (`node script.js`).
const BARE_NODE_RE = /(^|\$\(|`|[|;&!]|&&|\|\||\b(?:if|then|else|elif|do|while|until|exec|env|command|time)\s)\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*node\s+(-e\b|-p\b|--eval\b|--input-type|["'$]|[^\s-])/;

// True when index `at` of `line` sits inside a string literal as prose: inside '...',
// or inside "..." but not within a `$(...)` / backtick substitution opened in it (those
// execute, so a node there is a real call). Escapes honoured; unterminated quote = open.
function insideProse(line, at) {
  const stack = []; // 's' single, 'd' double, 'c' $( ), 'b' backtick
  for (let i = 0; i < at; i++) {
    const top = stack[stack.length - 1];
    const ch = line[i];
    if (ch === '\\' && top !== 's') { i++; continue; }
    if (top === 's') { if (ch === "'") stack.pop(); continue; }
    if (ch === '$' && line[i + 1] === '(' && top !== 'b') { stack.push('c'); i++; continue; }
    if (ch === ')' && top === 'c') { stack.pop(); continue; }
    if (ch === '`') { if (top === 'b') stack.pop(); else stack.push('b'); continue; }
    if (ch === '"') { if (top === 'd') stack.pop(); else stack.push('d'); continue; }
    if (ch === "'" && top !== 'd') { stack.push('s'); continue; }
  }
  const top = stack[stack.length - 1];
  return top === 's' || top === 'd';
}

// A line is a hit when at least one match of the call shape is NOT prose.
function callsBareNode(line) {
  const re = new RegExp(BARE_NODE_RE.source, 'g');
  let m;
  while ((m = re.exec(line)) !== null) {
    const before = m[0].slice(0, m[0].length - m[2].length).replace(/\s+$/, '');
    if (!insideProse(line, m.index + before.length - 4)) return true;
    if (m[0].length === 0) re.lastIndex++;
  }
  return false;
}

function bareNodeLines(body) {
  return body.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*#/.test(line) && callsBareNode(line));
}

module.exports = { BARE_NODE_RE, bareNodeLines };
