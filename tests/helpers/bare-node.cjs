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

// Commands that only PRINT their arguments, never execute them: a string handed to one
// of these is prose. Anything else (bash -c, sh -c, ssh host, eval, su -c, unknown
// wrappers, a JSON "command" value) may run its string as code, so it is never skipped.
const PRINTERS = new Set(['echo', 'printf', 'warn', 'log', 'die', 'msg', 'info', 'error', 'fail', 'print']);

// Scan the whole line. Returns the opener index of the string that contains `at`
// (quote state: single/double; a `$(...)` or backtick opened inside a double quote
// executes, so it is not "in" the string), or -1. A line with an unbalanced quote
// (multi-line string) yields -1 everywhere: only spans that open AND close on this
// line are ever skipped.
function enclosingString(line, at) {
  const stack = []; // {t: 's'|'d'|'c'|'b', i}
  let found = -1;
  for (let i = 0; i < line.length; i++) {
    if (i === at) {
      const top = stack[stack.length - 1];
      if (top && (top.t === 's' || top.t === 'd')) found = top.i;
    }
    const top = stack[stack.length - 1];
    const ch = line[i];
    if (ch === '\\' && (!top || top.t !== 's')) { i++; continue; }
    if (top && top.t === 's') { if (ch === "'") stack.pop(); continue; }
    if (ch === '$' && line[i + 1] === '(' && !(top && top.t === 'b')) { stack.push({ t: 'c', i }); i++; continue; }
    if (ch === ')' && top && top.t === 'c') { stack.pop(); continue; }
    if (ch === '`') { if (top && top.t === 'b') stack.pop(); else stack.push({ t: 'b', i }); continue; }
    if (ch === '"') { if (top && top.t === 'd') stack.pop(); else stack.push({ t: 'd', i }); continue; }
    if (ch === "'" && !(top && top.t === 'd')) { stack.push({ t: 's', i }); continue; }
  }
  return stack.length ? -1 : found;
}

// True when `at` is inside a string literal that is an argument of a printing command.
const SHELL_PIPE = /\|&?\s*\(?\s*(?:(?:sudo|env|exec|command|xargs|busybox|nohup)\s+(?:-\S+\s+)*)*(?:\S*\/)?(?:sh|bash|zsh|dash|ksh|mksh|ash|fish)\b/;

function insideProse(line, at) {
  const open = enclosingString(line, at);
  if (open < 0) return false;
  // Prose piped into a shell executes (`echo "a; node x" | sh`): not prose. Covers an
  // absolute path (`| /bin/sh`), a subshell `(`, wrappers (`| sudo bash`, `| env bash`,
  // `| xargs sh -c`, `| busybox sh`) and the common shells. Over-flags such as
  // `| tee bash.log` are accepted: a false positive costs a look, a miss ships a bare node.
  if (SHELL_PIPE.test(line)) return false;
  const seg = line.slice(0, open).split(/[;&|(`]/).pop().trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/, '');
  return PRINTERS.has(seg.split(/\s+/)[0]);
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
