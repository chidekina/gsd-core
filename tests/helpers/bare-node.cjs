'use strict';
// [gsd-local] One predicate for "this shell line calls a bare `node`", shared by the
// tests that pin the fork's .sh hooks to hooks/gsd-node-runner.sh (gsd-core#3 review,
// NIT-1/NIT-b). Command position only — line start, `$(`, a pipe or list operator,
// optionally after VAR=value assignments — followed by an argument node would run:
// -e/-p/--eval/--input-type, a quoted script, a variable, or a script path. Prose such as
// "no node could be resolved" and names such as gsd_node never match. Comment lines
// are the caller's job to drop.
// Prefixes widened after the second re-review (LOW-2): backticks, `!`, the compound-command
// keywords, the exec/env/command/time wrappers, quoted assignment values, and an unquoted
// script path (`node script.js`).
const BARE_NODE_RE = /(^|\$\(|`|[|;&!]|&&|\|\||\b(?:if|then|else|elif|do|while|until|exec|env|command|time)\s)\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*node\s+(-e\b|-p\b|--eval\b|--input-type|["'$]|[^\s-])/;

function bareNodeLines(body) {
  return body.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*#/.test(line) && BARE_NODE_RE.test(line));
}

module.exports = { BARE_NODE_RE, bareNodeLines };
