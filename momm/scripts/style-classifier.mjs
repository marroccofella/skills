// MOMM 1.17 B4.1 — mechanical `style`. A governor's decision may be recorded as `style` only when the
// bytes say so: every changed line is whitespace, or a comment line that is added, removed or reworded
// (a whole comment line inserted or deleted is style; a line that is code in its old or its new form is
// behavior), and no changed comment carries a tool directive. The label is never taken on trust
// (plan-1.17.md, "Mechanical style"; owner decision D4).
//
// Fail closed everywhere. Anything this file cannot read with confidence is `behavior`, which needs a
// failing-before and passing-after record: a type with no known comment syntax (Markdown, JSON, HTML,
// unknown), binary or non-UTF-8 bytes, generated files, JSX markup, string forms it does not model, a
// block comment spanning lines, and whitespace changes to code in whitespace-significant files.
// A line inside a multi-line string, template or heredoc is string content, never a comment.
// Pure and dependency-free: bytes in, verdict out. Nothing here is executed or evaluated.

export const STYLE_CLASSIFIER_VERSION = "momm-style/1";

// One versioned list. A comment matching any entry is a tool directive: it changes what a linter,
// type checker, coverage tool, formatter, interpreter or build step does, so it is behavior. The first
// fifteen are the plan's list; the rest are the same kind of switch in the supported languages.
const D = (id, pattern, languages = null) => Object.freeze({ id, pattern, languages });
export const STYLE_DIRECTIVES = Object.freeze([
  D("eslint-disable", /eslint-disable/i),
  D("eslint-enable", /eslint-enable/i),
  D("@ts-ignore", /@ts-ignore/i),
  D("@ts-expect-error", /@ts-expect-error/i),
  D("@ts-nocheck", /@ts-nocheck/i),
  D("prettier-ignore", /prettier-ignore/i),
  D("istanbul ignore", /istanbul\s+ignore/i),
  D("c8 ignore", /\bc8\s+ignore/i),
  D("noqa", /\bnoqa\b/i),
  D("type: ignore", /\btype:\s*ignore\b/i),
  D("pragma", /\bpragma\b/i),
  D("#!", /#!/),
  D("-*- coding", /-\*-.*-\*-|\bcoding[:=]|\bfileencoding\b/i),
  D("nolint", /\bnolint\b/i),
  D("NOSONAR", /nosonar/i),
  // Additions of the same kind (version momm-style/1).
  D("eslint configuration", /^\/\*\s*eslint(?:-env)?\s/i),
  D("global declaration", /^\/\*\s*globals?\s/),
  D("jshint/jslint", /\bjs[hl]int\b/i),
  D("@ts-check", /@ts-check/i),
  D("triple-slash directive", /^\/\/\/\s*<(?:reference|amd-)/),
  D("flow/jsx pragma", /@(?:flow|noflow|jsx\w*)\b/),
  D("formatter/linter ignore", /\b(?:biome-ignore|dprint-ignore|deno-(?:lint|fmt)-ignore|v8\s+ignore|nosemgrep|lgtm|codeql)\b/i),
  D("source map", /[#@]\s*source(?:Mapping)?URL=/i),
  D("minifier annotation", /@(?:license|preserve|__PURE__|__NOINLINE__|__INLINE__)|#__PURE__/i),
  D("bundler magic comment", /\bwebpack[A-Z]\w*|@vite-ignore/),
  D("python tool", /\b(?:pylint|mypy|pyright|ruff|isort|flake8|pyre-\w+)\s*:|\bfmt:\s*(?:off|on|skip)\b|\bnosec\b/i),
  D("python type comment", /^#\s*type:/i, ["py"]),
  D("vim modeline", /\bvim?:\s*set?\s/),
  D("go directive", /^\/\/(?:go:|line |export |extern |\s?\+build)/),
  D("lint ignore", /\blint:(?:ignore|file-ignore)\b|\bNOLINT/i),
  D("rubocop", /\brubocop:/i),
  D("ruby magic comment", /\b(?:frozen_string_literal|encoding|warn_indent|shareable_constant_value|typed)\s*:/i, ["rb"]),
  D("shellcheck", /\bshellcheck\b/i),
  D("yamllint", /\byamllint\b/i),
  D("powershell requires", /^#\s*requires\b/i, ["ps1"]),
  D("formatter switch", /@formatter:(?:off|on)|clang-format\s+(?:off|on)|CHECKSTYLE:(?:OFF|ON)|\bswiftlint:|\bsourcery:|ReSharper\s+(?:disable|restore)|gitleaks:allow/i),
]);

const JS = ["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"];
const LANGUAGE = Object.freeze(Object.fromEntries([
  ...JS.map(e => [e, "js"]),
  ...["c", "h"].map(e => [e, "c"]), ...["cpp", "cc", "cxx", "hpp", "hh", "hxx"].map(e => [e, "cpp"]),
  ["java", "java"], ["cs", "cs"], ["go", "go"], ["rs", "rs"], ["swift", "swift"], ["kt", "kt"], ["kts", "kt"],
  ["css", "css"], ["py", "py"], ["sh", "sh"], ["bash", "sh"], ["rb", "rb"], ["yaml", "yaml"], ["yml", "yaml"],
  ["toml", "toml"], ["ps1", "ps1"],
]));
const LOOKAHEAD = 256; // longest literal prefix examined: heredoc words, raw-string delimiters
// Characters that can begin a literal, per language; anything else is ordinary code.
const STARTERS = Object.freeze({ js: "'\"`/", css: "'\"", c: "'\"", cpp: "'\"RuUL", java: "'\"", cs: "'\"@$", go: "'\"`", rs: "'\"br",
  swift: "'\"#", kt: "'\"", py: "'\"", toml: "'\"", sh: "'\"`<$", rb: "'\"`</?%", yaml: "'\"", ps1: "'\"@" });
const C_LIKE = new Set(["c", "cpp", "java", "cs", "go", "rs", "swift", "kt"]);
const HASH = new Set(["py", "sh", "rb", "yaml", "toml", "ps1"]);
const WHITESPACE_SIGNIFICANT = new Set(["py", "yaml"]);
const NESTED_BLOCKS = new Set(["rs", "swift", "kt"]);
const TRIPLE_QUOTES = new Set(["java", "kt", "swift", "cs"]);
const JS_REGEX_KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const RB_REGEX_KEYWORDS = new Set(["if", "elsif", "unless", "when", "while", "until", "and", "or", "not", "return", "then"]);

const unclassifiable = (file, why) => ({ style: false, reason: `${file}: file type unclassifiable (${why})`, line: null });

function languageOf(file) {
  const base = String(file).split("/").pop();
  if (/^(?:GNU)?makefile$/i.test(base) || /\.(?:mk|hs|lhs)$/i.test(base)) return { error: "whitespace-significant with no recognised comment syntax" };
  if (/\.min\.(?:js|css)$|\.generated\.|\.g\.cs$|\.designer\.cs$|\.pb\.go$|_pb2\.py$/i.test(base)) return { error: "generated file" };
  const match = /\.([A-Za-z0-9]+)$/.exec(base);
  const lang = match && LANGUAGE[match[1].toLowerCase()];
  return lang ? { lang, ext: match[1].toLowerCase() } : { error: "no recognised comment syntax" };
}

// Tokenise one version of a file into lines. Each line is `blank`, `comment` (only comments, starting
// and ending outside any string or block) or `code`; `norm` collapses whitespace outside strings.
function scan(lang, text) {
  // The empty element after a final newline is not a line; whether the file ends in one is kept apart.
  const raws = text.split("\n"), finalNewline = text.endsWith("\n");
  if (finalNewline) raws.pop();
  const lines = [];
  const stack = [{ t: "code" }];
  const top = () => stack[stack.length - 1];
  let uncertain = null, jsx = false, prevSig = null, prevWord = "", gap = true, continued = false;
  const fail = why => { uncertain ??= why; };
  for (let n = 0; n < raws.length; n++) {
    const raw = raws[n];
    // A carriage return is part of a shell word (it breaks the command); elsewhere it ends the line.
    const line = raw.endsWith("\r") && lang !== "sh" ? raw.slice(0, -1) : raw;
    let norm = "", pending = false, codeSeen = false, openedBlock = false, codeText = "";
    gap = true;
    const comments = [];
    const heredocs = [];
    const yaml = lang === "yaml"; // only YAML needs the code text (block scalar indicators)
    const emitCode = s => { if (pending && norm) { norm += " "; if (yaml) codeText += " "; } pending = false; norm += s; codeSeen = true; if (yaml) codeText += s; };
    const emitComment = s => { if (pending && norm) norm += " "; pending = false; norm += s.replace(/\s+/g, " ").trim(); comments.push(s); };
    // Line-based states: heredocs, here-strings, YAML block scalars, Ruby =begin blocks.
    const lineState = top();
    if (lineState.t === "heredoc") {
      const probe = lineState.strip === "tabs" ? line.replace(/^\t+/, "") : lineState.strip === "indent" ? line.trimStart() : line;
      if (lineState.prefix ? probe.startsWith(lineState.word) : probe === lineState.word) stack.pop();
      lines.push({ raw, kind: "code", norm: raw, content: true });
      continue;
    }
    if (lineState.t === "rbblock") {
      // Ruby ends an embedded document only at "=end" followed by whitespace or the end of the line
      // ("=endx" does not); closing early would read the rest of the document as code (final review).
      if (/^=end(?:[\s\0\x04\x1a]|$)/.test(line)) stack.pop();
      lines.push({ raw, kind: "code", norm: raw, content: true });
      continue;
    }
    if (lineState.t === "yamlblock") {
      const indent = /^[ \t]*/.exec(line)[0].length;
      if (!line.trim() || indent > lineState.indent) { lines.push({ raw, kind: "code", norm: raw, content: true }); continue; }
      stack.pop();
    }
    if (lang === "rb" && top().t === "code" && line.startsWith("=begin")) { stack.push({ t: "rbblock" }); lines.push({ raw, kind: "code", norm: raw, content: true }); continue; }
    if (lang === "rb" && top().t === "code" && line === "__END__") fail("Ruby __END__ data section");
    const startsInCode = top().t === "code";
    let i = 0;
    const lastQuote = Math.max(line.lastIndexOf("'"), line.lastIndexOf('"'), line.lastIndexOf("`"));
    if (n === 0 && line.startsWith("#!")) { emitComment(line); i = line.length; }
    while (i < line.length) {
      // Index-based throughout (no per-character slicing), so the scan stays linear in the line length:
      // a minified line can be megabytes.
      const state = top(), c = line[i];
      if (state.t === "code") {
        if (c === " " || c === "\t" || c === "\f" || c === "\v" || (c === "\r" && lang !== "sh")) { if (norm) pending = true; gap = true; i++; continue; }
        // Line comments. In shell, PowerShell and YAML a hash starts one only at the start of a word.
        if (((lang === "js" || C_LIKE.has(lang)) && line.startsWith("//", i))
          || (HASH.has(lang) && c === "#" && (lang === "py" || lang === "rb" || lang === "toml" || i === 0 || (lang === "yaml" ? /\s/ : /[\s;&|()<>]/).test(line[i - 1])))) {
          emitComment(line.slice(i)); i = line.length; break;
        }
        // Block comments: single-line ones are comments; one left open makes this and later lines code.
        const blockOpen = (lang === "js" || C_LIKE.has(lang) || lang === "css") ? "/*" : lang === "ps1" ? "<#" : null;
        if (blockOpen && line.startsWith(blockOpen, i)) {
          const close = blockOpen === "/*" ? "*/" : "#>";
          let depth = 1, j = i + 2;
          while (j < line.length && depth > 0) {
            if (line.startsWith(close, j)) { depth--; j += 2; }
            else if (NESTED_BLOCKS.has(lang) && line.startsWith(blockOpen, j)) { depth++; j += 2; }
            else j++;
          }
          if (depth === 0) { emitComment(line.slice(i, j)); i = j; continue; }
          // Left open: the line is code, and the comment's opening text is part of its key, raw like the
          // lines that continue it, so a rewording or a directive there is never an unchanged line (final review).
          if (pending && norm) norm += " ";
          pending = false; norm += line.slice(i, j); comments.push(line.slice(i, j));
          stack.push({ t: "block", close, depth, nest: NESTED_BLOCKS.has(lang), open: blockOpen }); openedBlock = true; i = j; continue;
        }
        // Strings and other literals.
        const opened = STARTERS[lang].includes(c) ? openLiteral(lang, line, i, { prevSig, prevWord, fail, n, heredocs, quoteAfter: at => lastQuote > at }) : null;
        if (opened) {
          if (opened.jsx) jsx = true;
          if (opened.state) stack.push(opened.state);
          emitCode(line.slice(i, opened.end)); i = opened.end;
          if (opened.state) prevSig = null; else { prevSig = "x"; prevWord = ""; }
          continue;
        }
        if (lang === "js" && (line.startsWith("/>", i) || (line.startsWith("</", i) && /[A-Za-z>]/.test(line[i + 2] ?? "")))) jsx = true;
        if (state.tpl && c === "{") state.depth++;
        if (state.tpl && c === "}") {
          if (state.depth === 0) { stack.pop(); emitCode(c); i++; continue; }
          state.depth--;
        }
        emitCode(c);
        if (/[\w$]/.test(c)) prevWord = !gap && /[\w$]/.test(prevSig ?? "") ? prevWord + c : c; else prevWord = "";
        prevSig = c; gap = false; i++;
        continue;
      }
      if (state.t === "block") {
        let j = i;
        while (j < line.length && state.depth > 0) {
          if (line.startsWith(state.close, j)) { state.depth--; j += 2; }
          else if (state.nest && line.startsWith(state.open, j)) { state.depth++; j += 2; }
          else j++;
        }
        comments.push(line.slice(i, j)); norm += line.slice(i, j);
        if (state.depth === 0) stack.pop();
        i = j; continue;
      }
      if (state.t === "str") {
        let j = i, closed = false;
        while (j < line.length) {
          if (state.esc && line[j] === state.esc) { j += 2; continue; }
          if (state.doubled && line.startsWith(state.q + state.q, j)) { j += 2 * state.q.length; continue; }
          if (line.startsWith(state.q, j)) { j += state.q.length; closed = true; break; }
          j++;
        }
        const end = Math.min(j, line.length);
        emitCode(line.slice(i, end)); i = end;
        if (closed) { stack.pop(); prevSig = "x"; prevWord = ""; }
        continue;
      }
      if (state.t === "tpl") {
        let j = i, next = null;
        while (j < line.length) {
          if (line[j] === "\\") { j += 2; continue; }
          if (line[j] === "`") { next = "close"; j++; break; }
          if (line.startsWith("${", j)) { next = "expr"; j += 2; break; }
          j++;
        }
        const end = Math.min(j, line.length);
        emitCode(line.slice(i, end)); i = end;
        if (next === "close") { stack.pop(); prevSig = "x"; prevWord = ""; }
        if (next === "expr") { stack.push({ t: "code", tpl: true, depth: 0 }); prevSig = "{"; prevWord = ""; }
        continue;
      }
      fail(`unexpected state ${state.t}`); break;
    }
    // End of line.
    const endState = top();
    if (endState.t === "str" && !endState.multi) {
      // A single-line string may continue only with a trailing backslash.
      if (!(endState.esc && /(^|[^\\])(\\\\)*\\$/.test(line))) { fail(`unterminated string on line ${n + 1}`); stack.pop(); }
    }
    if (heredocs.length && top().t !== "code") fail(`a heredoc starts on line ${n + 1} inside an open string`);
    else for (const h of heredocs.reverse()) stack.push(h);
    if (lang === "yaml" && top().t === "code") {
      const value = codeText.trimEnd();
      if (/(?:^|\s)[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(value)) stack.push({ t: "yamlblock", indent: /^[ \t]*/.exec(line)[0].length });
    }
    const endsInCode = top().t === "code" && !openedBlock;
    const endsWithBackslash = /\\\s*$/.test(line);
    let kind;
    if (!startsInCode || !endsInCode || continued || endsWithBackslash) kind = "code";
    else if (!codeSeen && comments.length === 0) kind = "blank";
    else if (!codeSeen) kind = "comment";
    else kind = "code";
    lines.push({ raw, kind, norm, comments, content: !startsInCode });
    continued = endsWithBackslash;
  }
  if (top().t === "yamlblock") stack.pop(); // a block scalar may run to the end of the file
  if (stack.length !== 1 || top().t !== "code") fail("a string, heredoc or comment is still open at the end of the file");
  return { lines, uncertain, jsx, finalNewline };
}

// A literal that starts at `i` in code: returns { end, state? } (state when it continues past this
// line), or null when `i` does not start one.
function openLiteral(lang, line, i, ctx) {
  const c = line[i];
  if (!STARTERS[lang].includes(c)) return null;
  const rest = line.slice(i, i + LOOKAHEAD);
  const prevIdent = i > 0 && /[\w$]/.test(line[i - 1]);
  const scanClosed = (start, q, { esc = "\\", doubled = false } = {}) => {
    let j = start;
    while (j < line.length) {
      if (esc && line[j] === esc) { j += 2; continue; }
      if (doubled && line.startsWith(q + q, j)) { j += 2 * q.length; continue; }
      if (line.startsWith(q, j)) return j + q.length;
      j++;
    }
    return -1;
  };
  const string = (q, start, opts = {}) => {
    const end = scanClosed(start, q, opts);
    if (end >= 0) return { end };
    return { end: line.length, state: { t: "str", q, esc: opts.esc === undefined ? "\\" : opts.esc, doubled: !!opts.doubled, multi: !!opts.multi } };
  };
  switch (lang) {
    case "js": {
      if (c === "'" || c === '"') return string(c, i + 1);
      if (c === "`") return { end: i + 1, state: { t: "tpl" } };
      if (c === "/" && line[i + 1] !== "/" && line[i + 1] !== "*") {
        const p = ctx.prevSig;
        const regex = p === null || /[(,=:[!&|?{};+\-*%<>~^]/.test(p) || (/[\w$]/.test(p) && JS_REGEX_KEYWORDS.has(ctx.prevWord));
        if (!regex) {
          if (p === ")" && ctx.quoteAfter(i)) ctx.fail(`ambiguous division or regular expression on line ${ctx.n + 1}`);
          return null;
        }
        const end = regexEnd(line, i);
        if (end < 0) { ctx.fail(`unterminated regular expression on line ${ctx.n + 1}`); return { end: line.length }; }
        return { end };
      }
      return null;
    }
    case "css":
      return c === "'" || c === '"' ? string(c, i + 1) : null;
    case "c": case "cpp": case "java": case "cs": case "go": case "rs": case "swift": case "kt": {
      if (lang === "swift" && c === "#" && /^#+"/.test(rest)) { ctx.fail("Swift extended string delimiters"); return { end: line.length }; }
      if (lang === "cpp" && !prevIdent) {
        const raw = /^(?:u8|u|U|L)?R"([^()\\\s]{0,16})\(/.exec(rest);
        if (raw) { const q = `)${raw[1]}"`, start = i + raw[0].length, end = line.indexOf(q, start); return end >= 0 ? { end: end + q.length } : { end: line.length, state: { t: "str", q, esc: null, multi: true } }; }
      }
      if (lang === "rs" && !prevIdent) {
        const raw = /^b?r(#*)"/.exec(rest);
        if (raw) { const q = `"${raw[1]}`, start = i + raw[0].length, end = line.indexOf(q, start); return end >= 0 ? { end: end + q.length } : { end: line.length, state: { t: "str", q, esc: null, multi: true } }; }
      }
      if (lang === "cs" && !prevIdent) {
        const verbatim = /^(?:\$@|@\$|@)"/.exec(rest);
        if (verbatim) return string('"', i + verbatim[0].length, { esc: null, doubled: true, multi: true });
      }
      if (TRIPLE_QUOTES.has(lang) && rest.startsWith('"""')) {
        if (rest.startsWith('""""')) { ctx.fail("raw string with more than three quotes"); return { end: line.length }; }
        return string('"""', i + 3, { multi: true });
      }
      if (lang === "go" && c === "`") { const end = line.indexOf("`", i + 1); return end >= 0 ? { end: end + 1 } : { end: line.length, state: { t: "str", q: "`", esc: null, multi: true } }; }
      if (c === '"') return string('"', i + 1, { multi: lang === "rs" });
      if (c === "'") {
        if (lang === "rs") {
          // Scan from the backslash itself so the escape is consumed whole: an escaped backslash or quote
          // (a char literal holding one backslash, or one quote) no longer swallows the closing quote and
          // the code after it (gate-3 review of 1.17.0).
          if (line[i + 1] === "\\") { const end = scanClosed(i + 1, "'"); return end >= 0 ? { end } : null; }
          // One Unicode scalar value: two UTF-16 units when it lies outside the BMP (U+1F980), so a closing
          // quote at i + 2 alone took such a literal for a lifetime (final review).
          const width = (line.codePointAt(i + 1) ?? 0) > 0xffff ? 2 : 1;
          if (line[i + 1 + width] === "'") return { end: i + 2 + width };
          return null; // a lifetime
        }
        const end = scanClosed(i + 1, "'");
        return end >= 0 ? { end } : null;
      }
      return null;
    }
    case "py": {
      if (rest.startsWith('"""') || rest.startsWith("'''")) return string(rest.slice(0, 3), i + 3, { multi: true });
      if (c === "'" || c === '"') return string(c, i + 1);
      return null;
    }
    case "toml": {
      if (rest.startsWith('"""')) return string('"""', i + 3, { multi: true });
      if (rest.startsWith("'''")) return string("'''", i + 3, { esc: null, multi: true });
      if (c === '"') return string('"', i + 1);
      if (c === "'") return string("'", i + 1, { esc: null });
      return null;
    }
    case "sh": {
      const heredoc = /^<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w-]*))/.exec(rest);
      if (heredoc && !rest.startsWith("<<<")) {
        ctx.heredocs.push({ t: "heredoc", word: heredoc[2] ?? heredoc[3] ?? heredoc[4], strip: heredoc[1] ? "tabs" : null });
        return { end: i + heredoc[0].length };
      }
      if (rest.startsWith("$'")) return string("'", i + 2, { multi: true });
      if (c === "'") return string("'", i + 1, { esc: null, multi: true });
      if (c === '"') return string('"', i + 1, { multi: true });
      if (c === "`") return string("`", i + 1, { multi: true });
      return null;
    }
    case "rb": {
      const heredoc = /^<<([~-]?)(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([A-Za-z_]\w*))/.exec(rest);
      if (heredoc && (heredoc[1] || !heredoc[5] || /^[A-Z_]/.test(heredoc[5]))) {
        ctx.heredocs.push({ t: "heredoc", word: heredoc[2] ?? heredoc[3] ?? heredoc[4] ?? heredoc[5], strip: heredoc[1] ? "indent" : null });
        return { end: i + heredoc[0].length };
      }
      if (c === "?" && /^\?['"`]/.test(rest)) { ctx.fail("Ruby character literal"); return { end: line.length }; }
      if (c === "%" && /^%[qQwWiIrsx]?[^\w\s=]/.test(rest)) { ctx.fail("Ruby percent literal"); return { end: line.length }; }
      if (c === "'" || c === '"' || c === "`") return string(c, i + 1, { multi: true });
      if (c === "/") {
        const p = ctx.prevSig;
        if (p === null || /[(,=~!&|?{};+\-*%<>^[]/.test(p) || (/\w/.test(p) && RB_REGEX_KEYWORDS.has(ctx.prevWord))) {
          const end = regexEnd(line, i);
          if (end < 0) { ctx.fail(`unterminated regular expression on line ${ctx.n + 1}`); return { end: line.length }; }
          return { end };
        }
        if ((p === ")" || /\w/.test(p)) && ctx.quoteAfter(i)) ctx.fail(`ambiguous division or regular expression on line ${ctx.n + 1}`);
      }
      return null;
    }
    case "yaml": {
      if (c !== "'" && c !== '"') return null;
      const before = line.slice(0, i).trimEnd();
      if (before && !/[:\-,[{?]$/.test(before)) return null; // an apostrophe inside a plain scalar
      return c === "'" ? string("'", i + 1, { esc: null, doubled: true, multi: true }) : string('"', i + 1, { multi: true });
    }
    case "ps1": {
      if (c === "@" && (line[i + 1] === '"' || line[i + 1] === "'") && !line.slice(i + 2).trim()) { ctx.heredocs.push({ t: "heredoc", word: `${line[i + 1]}@`, prefix: true }); return { end: line.length }; }
      if (c === '"') return string('"', i + 1, { esc: "`", doubled: true, multi: true });
      if (c === "'") return string("'", i + 1, { esc: null, doubled: true, multi: true });
      return null;
    }
    default: return null;
  }
}

function regexEnd(line, i) {
  let j = i + 1, inClass = false;
  while (j < line.length) {
    const c = line[j];
    if (c === "\\") { j += 2; continue; }
    if (inClass) { if (c === "]") inClass = false; }
    else if (c === "[") inClass = true;
    else if (c === "/") { j++; while (j < line.length && /[A-Za-z]/.test(line[j])) j++; return j; }
    j++;
  }
  return -1;
}

// Longest common subsequence over line keys, with the common prefix and suffix removed first.
// Returns ordered operations, deletions before insertions within a change, or null when too large.
function diff(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const n = a.length - s - e, m = b.length - s - e;
  if ((n + 1) * (m + 1) > 4_000_000) return null;
  const width = m + 1, table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    table[i * width + j] = a[s + i] === b[s + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const ops = [];
  for (let k = 0; k < s; k++) ops.push({ op: "=", i: k, j: k });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[s + i] === b[s + j]) { ops.push({ op: "=", i: s + i, j: s + j }); i++; j++; }
    else if (j >= m || (i < n && table[(i + 1) * width + j] >= table[i * width + j + 1])) { ops.push({ op: "-", i: s + i }); i++; }
    else { ops.push({ op: "+", j: s + j }); j++; }
  }
  for (let k = 0; k < e; k++) ops.push({ op: "=", i: a.length - e + k, j: b.length - e + k });
  return ops;
}

// Each comment is tested as written and with its whitespace runs collapsed, the form its line key
// compares: tools read directives through spacing ("//  +build" is a build constraint), and a
// whitespace-only edit must never make a directive pass unseen (final review).
const directiveIn = (lang, comments = []) => comments.some(text => [text.trim(), text.replace(/\s+/g, " ").trim()]
  .some(form => STYLE_DIRECTIVES.some(d => (!d.languages || d.languages.includes(lang)) && d.pattern.test(form))));

/**
 * Decide whether changing `file` from `before` to `after` is mechanical style.
 * @param {string} file project-relative path, used for the language and in the reason
 * @param {Buffer|Uint8Array} before the reviewed bytes
 * @param {Buffer|Uint8Array} after the bytes now
 * @returns {{style: boolean, reason: string|null, line: number|null}}
 */
export function classifyStyleChange(file, before, after) {
  const old = Buffer.from(before), now = Buffer.from(after);
  if (old.equals(now)) return { style: true, reason: null, line: null };
  const type = languageOf(file);
  if (type.error) return unclassifiable(file, type.error);
  const decode = bytes => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; } };
  const oldText = decode(old), newText = decode(now);
  if (oldText === null || newText === null || oldText.includes("\0") || newText.includes("\0")) return unclassifiable(file, "binary or not UTF-8");
  const head = t => t.split("\n", 5).join("\n");
  if (/@generated|do not edit|auto-?generated|code generated/i.test(head(oldText) + "\n" + head(newText))) return unclassifiable(file, "generated file");
  const lang = type.lang;
  const a = scan(lang, oldText), b = scan(lang, newText);
  if (a.uncertain || b.uncertain) return unclassifiable(file, `cannot tokenise reliably: ${a.uncertain ?? b.uncertain}`);
  if (a.jsx || b.jsx) return unclassifiable(file, "JSX markup, where comment-like text can be rendered content");
  const key = l => l.kind === "blank" ? "B" : `${l.kind === "comment" ? "M" : "C"}:${l.norm}`;
  const ops = diff(a.lines.map(key), b.lines.map(key));
  if (!ops) return unclassifiable(file, "change too large to compare line by line");
  const wsSignificant = WHITESPACE_SIGNIFICANT.has(lang);
  const refuse = (line, what) => ({ style: false, reason: `${file}:${line} ${what}`, line });
  for (const { op, i, j } of ops) {
    if (op === "=") {
      const was = a.lines[i], is = b.lines[j];
      if (wsSignificant && is.kind === "code" && was.raw !== is.raw) return refuse(j + 1, "changes whitespace in a whitespace-significant file");
      // Same key, different bytes: only whitespace changed, which can still make or unmake a directive
      // ("//export<TAB>Foo" is a plain comment to Go, "//export Foo" is not), so a directive on either side
      // is behavior (final review).
      if (was.raw !== is.raw && (directiveIn(lang, was.comments) || directiveIn(lang, is.comments))) return refuse(j + 1, "carries a directive");
      continue;
    }
    const entry = op === "-" ? a.lines[i] : b.lines[j], at = op === "-" ? i + 1 : j + 1;
    if (entry.kind === "blank") continue;
    if (entry.kind === "code") return refuse(at, "changes code");
    if (directiveIn(lang, entry.comments)) return refuse(at, "carries a directive");
  }
  // A final newline added or removed is whitespace, except after string content (a YAML block scalar
  // keeps it in its value) and in whitespace-significant files, which fail closed.
  if (a.finalNewline !== b.finalNewline) {
    const at = Math.max(b.lines.length, 1);
    if (wsSignificant) return refuse(at, "changes whitespace in a whitespace-significant file");
    if ([a.lines[a.lines.length - 1], b.lines[b.lines.length - 1]].some(l => l?.content)) return refuse(at, "changes code");
  }
  return { style: true, reason: null, line: null };
}
