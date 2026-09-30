// MOMM 1.16.0 E5 — diff splitter. Zero dependencies, Node 18+.
//
// Packing rule (documented here, asserted in split.test.mjs):
//   1. Parse the diff into files; a file that fits under the ceiling is one
//      indivisible unit. A file over the ceiling is split at hunk boundaries:
//      hunks are packed sequentially (order preserved) into chunks, and EVERY
//      chunk repeats the file's header verbatim so it is a valid diff on its
//      own. Only the header is repeated — never a context line — so the only
//      text duplicated across pieces is header text, which headerOnlyQuote()
//      lets the parent merge ignore during corroboration.
//   2. A single hunk that does not fit under the ceiling even alone (header +
//      hunk > ceiling) becomes an `oversize` entry (with its file header, so
//      it too is a valid diff) and is excluded from `pieces`, UNLESS the caller
//      passes `lineSplit: true` and rule 2b below can divide it. The option
//      defaults to off in this module; the dispatcher turns it on unless
//      --no-line-split is given. Rule 2b never cuts a replaced block (removals
//      and the additions right after them); a block over the ceiling is a piece
//      of its own, marked overCeiling, when it fits `maxPieceBytes` (1.17 A4.1).
//      Nothing is ever dropped.
//   3. Whole-file units are grouped by directory (posix dirname), groups sorted
//      by dirname. Within a group, units are packed first-fit-decreasing by
//      size (ties by path) into bins up to the ceiling. Bins are then walked in
//      group order and ADJACENT bins are merged greedily when their combined
//      size fits, so a piece always covers a contiguous run of directories and
//      the piece count only ever goes down. Files inside a piece are emitted
//      in their original diff order.
//   4. Piece order follows the original diff position of each piece's first
//      file; ids are zero-padded, so the same input always yields the same
//      pieces.
// Text before the first `diff --git` line (stat preambles, mail headers) is
// not part of any file and is not carried into pieces.

const HEADER_LINE = /^(?:diff --git |index [0-9a-f]|--- |\+\+\+ |@@ |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/;

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function detectEol(text) {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

// Lines WITH their terminators so CRLF input round-trips byte for byte.
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function stripEol(line) {
  return line.replace(/\r?\n$/, "");
}

// Git C-quotes a path that contains a tab, newline, quote, backslash, control
// or (by default) non-ASCII byte: +++ "b/dir/a\tb.txt", "caf\303\251.js".
// Octal escapes are UTF-8 BYTES, so the whole path is decoded to bytes first.
const SIMPLE_ESCAPES = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11, "\\": 92, '"': 34 };
const QUOTED = /^"(?:[^"\\]|\\.)*"$/;
function unquoteGitPath(quoted) {
  const bytes = [];
  for (const m of quoted.slice(1, -1).matchAll(/\\([0-7]{1,3})|\\(.)|([^\\]+)|(\\)$/g)) {
    if (m[1] !== undefined) bytes.push(parseInt(m[1], 8) & 0xff);
    else if (m[2] !== undefined) bytes.push(...(m[2] in SIMPLE_ESCAPES ? [SIMPLE_ESCAPES[m[2]]] : [92, ...Buffer.from(m[2], "utf8")]));
    else if (m[3] !== undefined) bytes.push(...Buffer.from(m[3], "utf8"));
    else bytes.push(92);
  }
  return Buffer.from(bytes).toString("utf8");
}
// Decode a header path: unquote if quoted (an unquoted path may instead carry
// a "\t<timestamp>" suffix, which is dropped), then strip the a/ or b/ prefix.
function decodeGitPath(raw, prefix) {
  const value = QUOTED.test(raw) ? unquoteGitPath(raw) : raw.replace(/\t.*$/, "");
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function pathOf(headerLines) {
  const plain = headerLines.map(stripEol);
  for (const line of plain) {
    if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) return decodeGitPath(line.slice(4), "b/");
  }
  for (const line of plain) if (line.startsWith("rename to ")) return decodeGitPath(line.slice("rename to ".length), null);
  for (const line of plain) {
    if (line.startsWith("--- ") && !line.startsWith("--- /dev/null")) return decodeGitPath(line.slice(4), "a/");
  }
  const first = plain[0] || "";
  const quoted = /^diff --git ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(first);
  if (quoted) return decodeGitPath(quoted[2], "b/");
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(first);
  return match ? match[2] : first.replace(/^diff --git /, "");
}

export function parseUnifiedDiff(text) {
  const lines = splitLines(String(text ?? ""));
  const files = [];
  let file = null;
  let hunk = null;
  const closeHunk = () => {
    if (!hunk) return;
    hunk.bytes = byteLength(hunk.header) + byteLength(hunk.body);
    hunk.seq = file.hunks.length; // position in the file's original hunk order
    file.hunks.push(hunk);
    hunk = null;
  };
  const closeFile = () => {
    if (!file) return;
    closeHunk();
    file.header = file.headerLines.join("");
    delete file.headerLines;
    file.path = pathOf(splitLines(file.header));
    file.text = file.header + file.hunks.map((h) => h.header + h.body).join("");
    file.bytes = byteLength(file.text);
    files.push(file);
    file = null;
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeFile();
      file = { path: null, header: "", headerLines: [line], hunks: [], binary: false, bytes: 0, text: "" };
      continue;
    }
    if (!file) continue; // preamble before the first file
    if (line.startsWith("@@ ")) {
      closeHunk();
      hunk = { header: line, body: "", bytes: 0, seq: 0 };
      continue;
    }
    if (hunk) {
      hunk.body += line; // includes "\ No newline at end of file"
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) file.binary = true;
    file.headerLines.push(line);
  }
  closeFile();
  return files;
}

function padId(prefix, index, total) {
  return `${prefix}-${String(index).padStart(Math.max(2, String(total).length), "0")}`;
}

// Splits one over-ceiling file at hunk boundaries. Returns { chunks, oversize }
// where each chunk/oversize text starts with the file header. Every chunk
// records hunkSeqs (path -> original hunk positions) and every oversize entry
// its hunkSeq, so reassemble() can restore the file's original hunk order.
// Rule 2b (opt-in, `lineSplit: true`): an over-ceiling hunk is divided at line
// boundaries into consecutive sub-hunks whose `@@` ranges are recomputed, so
// every part is still a valid unified diff on its own and every quoted line
// still matches the artifact literally. Without this a whole new file larger
// than the ceiling (one hunk) was never seen by any route — it could only be
// governor_direct scope, which is why full-source peer quorum kept failing.
// Guarantees: nothing is dropped or duplicated; a "\ No newline at end of
// file" marker stays with the line it annotates; reassemble() restores the
// original hunk header and body byte for byte.
// Cut units (1.17 A4.1): a changed block is emitted as all `-` lines then all
// `+` lines, and a cut between them handed one route the removal and another
// its replacement. A maximal run of removals together with the run of
// additions immediately after it is ONE unit; every other line (context, a
// pure addition, a pure removal) is a unit of its own. Cuts fall only between
// units. A unit larger than the part budget becomes a part of its own, over
// the ceiling, when it fits `maxPartBytes` (the dispatcher passes the route
// input limit); a stretch of units too small to be worth a dispatch of its own
// (a quarter of the budget or less, such as the three context lines git puts
// around a change) rides with that over-ceiling part. A unit beyond
// `maxPartBytes` makes the WHOLE hunk fall back to `oversize` (rule 2). The
// default `maxPartBytes` is the ceiling: no part is ever over the ceiling
// unless the caller names a larger limit.
// Parts are review excerpts, never patches to apply on their own: a part may
// hold only context lines (a long unchanged stretch inside a large hunk), which
// is what lossless coverage requires and what a reviewer needs for the context.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const SECTION_BYTES = 80; // a part repeats the section heading; clipped by BYTES at a character boundary
function clipBytes(text, limit) {
  let out = "", used = 0;
  for (const ch of text) { const n = byteLength(ch); if (used + n > limit) break; out += ch; used += n; }
  return out;
}
// Balanced filling over a run of units that each fit the budget: the fewest
// parts the budget allows, each near the same size, so the tail is never a
// sliver that costs a dispatch per route and gives a reviewer almost nothing to
// read. The budget stays the hard limit. Cuts are planned on the running total:
// part k ends where the total is nearest k/n of the run. If any planned part
// would pass the budget, one more part is planned; n = units.length always fits.
function planParts(units, budget) {
  const totalBytes = units.reduce((n, u) => n + u.bytes, 0);
  if (totalBytes <= budget) return [units];
  let cutBefore = null;
  for (let n = Math.ceil(totalBytes / budget); n <= units.length && !cutBefore; n += 1) {
    const cuts = new Set();
    let running = 0, partBytes = 0, k = 1, fits = true;
    units.forEach((u, i) => {
      if (partBytes && k < n && running + u.bytes / 2 > (k * totalBytes) / n) { cuts.add(i); partBytes = 0; k += 1; }
      running += u.bytes; partBytes += u.bytes;
      if (partBytes > budget) fits = false;
    });
    if (fits) cutBefore = cuts;
  }
  // Balanced planning can overfill an early part before its next planned cut
  // (3 + 100 bytes against a 101-byte budget) and run out of part counts to
  // try. Every unit fits the budget on its own, so greedy filling always
  // succeeds: a divisible run is never sent to `oversize` by the heuristic.
  if (!cutBefore) {
    cutBefore = new Set();
    let partBytes = 0;
    units.forEach((u, i) => { if (partBytes && partBytes + u.bytes > budget) { cutBefore.add(i); partBytes = 0; } partBytes += u.bytes; });
  }
  const parts = [];
  let current = null;
  units.forEach((u, i) => { if (current && cutBefore.has(i)) { parts.push(current); current = null; } (current ??= []).push(u); });
  if (current) parts.push(current);
  return parts;
}
export function lineSplitHunk(fileHeader, hunk, ceiling, { maxPartBytes = ceiling } = {}) {
  const headerText = stripEol(hunk.header);
  const m = HUNK_HEADER.exec(headerText);
  if (!m) return null;
  const eol = hunk.header.endsWith("\r\n") ? "\r\n" : "\n";
  const section = clipBytes(m[5], SECTION_BYTES);
  // Reserve the largest header any part can have: no start or length printed
  // in a part exceeds the end line or the total length of the original hunk.
  const oldSpan = m[2] === undefined ? 1 : Number(m[2]), newSpan = m[4] === undefined ? 1 : Number(m[4]);
  const widest = (start, span) => String(Number(start) + span).length + 1 + String(span).length;
  const headerRoom = byteLength(`@@ - + @@${section}${eol}`) + widest(m[1], oldSpan) + widest(m[3], newSpan);
  const budget = ceiling - byteLength(fileHeader) - headerRoom;
  if (budget <= 0) return null;
  const partLimit = Math.max(ceiling, Math.floor(maxPartBytes));
  const hardBudget = partLimit - byteLength(fileHeader) - headerRoom;
  // Groups: one diff line plus any "\ No newline…" marker that annotates it.
  const groups = [];
  for (const line of splitLines(hunk.body)) {
    if (line.startsWith("\\") && groups.length) groups[groups.length - 1].text += line;
    else groups.push({ text: line, kind: line[0] === "+" || line[0] === "-" ? line[0] : " " });
  }
  for (const g of groups) g.bytes = byteLength(g.text);
  // Units (A4.1): a replaced block — removals plus the additions right after
  // them — is one unit; every other group is a unit of its own.
  const units = [];
  for (let i = 0; i < groups.length;) {
    let j = i;
    while (j < groups.length && groups[j].kind === "-") j += 1;
    let k = j;
    while (k < groups.length && groups[k].kind === "+") k += 1;
    if (j > i && k > j) { units.push({ groups: groups.slice(i, k) }); i = k; }
    else if (j > i) { for (let x = i; x < j; x += 1) units.push({ groups: [groups[x]] }); i = j; }
    else { units.push({ groups: [groups[i]] }); i += 1; }
  }
  for (const u of units) { u.bytes = u.groups.reduce((n, g) => n + g.bytes, 0); if (u.bytes > hardBudget) return null; }
  const totalBytes = units.reduce((n, u) => n + u.bytes, 0);
  if (totalBytes <= budget) return null; // fits in one part: not a split
  // Segments: runs of units that fit the budget, and each over-budget unit alone.
  const segments = [];
  for (const u of units) {
    const last = segments[segments.length - 1];
    if (u.bytes > budget) segments.push({ big: true, units: [u], bytes: u.bytes });
    else if (last && !last.big) { last.units.push(u); last.bytes += u.bytes; }
    else segments.push({ big: false, units: [u], bytes: u.bytes });
  }
  // A run of a quarter of the budget or less beside an over-ceiling part rides
  // with it rather than costing every route a dispatch for a few lines.
  const merged = [];
  segments.forEach((seg, s) => {
    const prev = merged[merged.length - 1], next = segments[s + 1];
    if (!seg.big && seg.bytes <= budget / 4) {
      if (prev?.big && prev.bytes + seg.bytes <= hardBudget) { prev.units.push(...seg.units); prev.bytes += seg.bytes; return; }
      if (next?.big && next.bytes + seg.bytes <= hardBudget) { next.units.unshift(...seg.units); next.bytes += seg.bytes; return; }
    }
    merged.push(seg);
  });
  const planned = merged.flatMap((seg) => (seg.big ? [{ units: seg.units, big: true }] : planParts(seg.units, budget).map((us) => ({ units: us, big: false }))));
  if (planned.length < 2) return null; // one part: the caller decides whether the whole hunk is a piece
  // Cursors hold the NEXT line number on each side. With a zero-length side
  // the header names the line BEFORE the insertion point, hence the +1.
  const oldLen0 = m[2] === undefined ? 1 : Number(m[2]), newLen0 = m[4] === undefined ? 1 : Number(m[4]);
  let oldCursor = Number(m[1]) + (oldLen0 === 0 ? 1 : 0), newCursor = Number(m[3]) + (newLen0 === 0 ? 1 : 0);
  const parts = [];
  for (const plan of planned) {
    const part = { body: "", bytes: 0, oldFirst: oldCursor, newFirst: newCursor, oldLen: 0, newLen: 0 };
    for (const g of plan.units.flatMap((u) => u.groups)) {
      part.body += g.text; part.bytes += g.bytes;
      if (g.kind !== "+") { part.oldLen += 1; oldCursor += 1; }
      if (g.kind !== "-") { part.newLen += 1; newCursor += 1; }
    }
    const oldStart = part.oldLen ? part.oldFirst : Math.max(0, part.oldFirst - 1);
    const newStart = part.newLen ? part.newFirst : Math.max(0, part.newFirst - 1);
    const header = `@@ -${oldStart},${part.oldLen} +${newStart},${part.newLen} @@${section}${eol}`;
    const bytes = byteLength(header) + part.bytes;
    parts.push({ header, body: part.body, bytes, overCeiling: byteLength(fileHeader) + bytes > ceiling, big: plan.big });
  }
  // Fail safe: a part that would not fit is a bug in the arithmetic above, and
  // the old rule (whole hunk oversize) is the honest answer, never a fat piece.
  // Only a part carrying an over-budget unit may pass the ceiling, never the limit.
  if (parts.some((p) => byteLength(fileHeader) + p.bytes > (p.big ? partLimit : ceiling))) return null;
  return parts.map(({ big, ...p }) => p);
}

function splitFile(file, ceiling, { lineSplit = false, maxPieceBytes = ceiling } = {}) {
  const chunks = [];
  const oversize = [];
  const headerBytes = byteLength(file.header);
  if (!file.hunks.length) {
    oversize.push({ path: file.path, hunkHeader: null, hunkSeq: null, bytes: file.bytes, text: file.text });
    return { chunks, oversize };
  }
  let current = null;
  const flush = () => {
    if (current) chunks.push({ files: [file.path], text: file.header + current.text, bytes: headerBytes + current.bytes, order: file.order, seq: chunks.length, hunkSeqs: { [file.path]: current.seqs } });
    current = null;
  };
  for (const hunk of file.hunks) {
    if (headerBytes + hunk.bytes > ceiling) {
      const parts = lineSplit ? lineSplitHunk(file.header, hunk, ceiling, { maxPartBytes: maxPieceBytes }) : null;
      if (parts) {
        // Parts keep the hunk's place in the file: flush what came before, then
        // emit each part as its own chunk in order.
        flush();
        parts.forEach((p, i) => chunks.push({ files: [file.path], text: file.header + p.header + p.body, bytes: headerBytes + p.bytes, order: file.order, seq: chunks.length, hunkSeqs: { [file.path]: [hunk.seq] },
          lineSplit: { path: file.path, hunkSeq: hunk.seq, part: i + 1, parts: parts.length, originalHeader: hunk.header }, ...(p.overCeiling ? { overCeiling: true } : {}) }));
        continue;
      }
      // A4.1: a hunk that cannot be divided (one replaced block and the few
      // lines around it, such as one changed long line) is still reviewed by the
      // panel when it fits the route input limit: the whole hunk, unchanged, as a
      // piece of its own over the ceiling. --no-line-split keeps the older rule.
      if (lineSplit && headerBytes + hunk.bytes <= maxPieceBytes) {
        flush();
        chunks.push({ files: [file.path], text: file.header + hunk.header + hunk.body, bytes: headerBytes + hunk.bytes, order: file.order, seq: chunks.length, hunkSeqs: { [file.path]: [hunk.seq] }, overCeiling: true });
        continue;
      }
      // Sibling hunks either side of an oversize hunk keep sharing a chunk:
      // hunks stay in ascending line order, so the chunk is still a valid diff.
      oversize.push({ path: file.path, hunkHeader: stripEol(hunk.header), hunkSeq: hunk.seq, bytes: headerBytes + hunk.bytes, text: file.header + hunk.header + hunk.body });
      continue;
    }
    if (current && current.bytes + hunk.bytes + headerBytes > ceiling) flush();
    if (!current) current = { text: "", bytes: 0, seqs: [] };
    current.text += hunk.header + hunk.body;
    current.bytes += hunk.bytes;
    current.seqs.push(hunk.seq);
  }
  flush();
  return { chunks, oversize };
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "." : p.slice(0, i);
}

// Whole-file units → bins (see packing rule steps 3 and 4).
function packUnits(units, ceiling) {
  const groups = new Map();
  for (const unit of units) {
    const dir = dirname(unit.path);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(unit);
  }
  const bins = [];
  for (const dir of [...groups.keys()].sort()) {
    const members = groups.get(dir).sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const groupBins = [];
    for (const unit of members) {
      const bin = groupBins.find((b) => b.bytes + unit.bytes <= ceiling);
      if (bin) { bin.units.push(unit); bin.bytes += unit.bytes; }
      else groupBins.push({ units: [unit], bytes: unit.bytes });
    }
    bins.push(...groupBins);
  }
  const merged = [];
  for (const bin of bins) {
    const last = merged[merged.length - 1];
    if (last && last.bytes + bin.bytes <= ceiling) { last.units.push(...bin.units); last.bytes += bin.bytes; }
    else merged.push({ units: [...bin.units], bytes: bin.bytes });
  }
  return merged.map((bin) => {
    const ordered = bin.units.sort((a, b) => a.order - b.order);
    return { files: ordered.map((u) => u.path), text: ordered.map((u) => u.text).join(""), bytes: bin.bytes, order: ordered[0].order, seq: 0, hunkSeqs: Object.fromEntries(ordered.map((u) => [u.path, u.hunks.map((h) => h.seq)])) };
  });
}

// maxPieceBytes (1.17 A4.1): the largest piece a route may be sent. The
// dispatcher passes its input limit; the default is the ceiling, so a caller
// that names no limit never receives a piece over the ceiling.
export function splitDiff(text, { ceilingBytes, minCeilingBytes = 4096, lineSplit = false, maxPieceBytes } = {}) {
  if (!Number.isFinite(ceilingBytes) || ceilingBytes <= 0) throw new TypeError("splitDiff: ceilingBytes must be a positive number");
  if (maxPieceBytes !== undefined && (!Number.isFinite(maxPieceBytes) || maxPieceBytes <= 0)) throw new TypeError("splitDiff: maxPieceBytes must be a positive number");
  const ceiling = Math.max(Math.floor(ceilingBytes), Math.floor(minCeilingBytes));
  const pieceLimit = maxPieceBytes === undefined ? ceiling : Math.max(ceiling, Math.floor(maxPieceBytes));
  let source = String(text ?? "");
  // git diff output always ends with a newline; restore a missing one so file
  // texts concatenate into valid diffs.
  if (source && !source.endsWith("\n")) source += detectEol(source);
  const files = parseUnifiedDiff(source);
  files.forEach((file, order) => { file.order = order; });
  const units = [];
  const rawPieces = [];
  const oversize = [];
  let filesOver = 0;
  for (const file of files) {
    if (file.bytes <= ceiling) { units.push(file); continue; }
    filesOver += 1;
    const split = splitFile(file, ceiling, { lineSplit, maxPieceBytes: pieceLimit });
    rawPieces.push(...split.chunks);
    oversize.push(...split.oversize.map((o) => ({ ...o, order: file.order })));
  }
  rawPieces.push(...packUnits(units, ceiling));
  rawPieces.sort((a, b) => a.order - b.order || a.seq - b.seq);
  oversize.sort((a, b) => a.order - b.order);
  const pieces = rawPieces.map((p, i) => ({ id: padId("piece", i + 1, rawPieces.length), files: p.files, text: p.text, bytes: p.bytes, oversize: false, hunkSeqs: p.hunkSeqs, ...(p.lineSplit ? { lineSplit: p.lineSplit } : {}), ...(p.overCeiling ? { overCeiling: true } : {}) }));
  const oversizeOut = oversize.map((o, i) => ({ id: padId("oversize", i + 1, oversize.length), path: o.path, hunkHeader: o.hunkHeader, hunkSeq: o.hunkSeq, bytes: o.bytes, text: o.text }));
  const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
  const lineSplitPieces = pieces.filter((p) => p.lineSplit);
  return {
    pieces,
    oversize: oversizeOut,
    stats: { files: files.length, hunks, pieces: pieces.length, oversize: oversizeOut.length, filesOverCeiling: filesOver, ceiling,
      lineSplitPieces: lineSplitPieces.length, lineSplitHunks: new Set(lineSplitPieces.map((p) => `${p.lineSplit.path}\0${p.lineSplit.hunkSeq}`)).size,
      overCeilingPieces: pieces.filter((p) => p.overCeiling).length, maxPieceBytes: pieceLimit },
  };
}

function oldStart(hunkHeader) {
  const m = /^@@ -(\d+)/.exec(hunkHeader);
  return m ? Number(m[1]) : 0;
}

// Rebuilds { files: [{ path, header, binary, hunks }] } from pieces and
// oversize entries. Hunks of a file are ordered by the original position
// splitDiff recorded at parse time (piece.hunkSeqs / oversize.hunkSeq), so a
// file whose hunks were scattered across pieces and oversize entries comes
// back in its original order even when old-side start lines tie. Parts built
// without that bookkeeping fall back to old-start line, then arrival order.
export function reassemble(pieces = [], oversize = []) {
  const byPath = new Map();
  const lineSplitParts = new Map(); // `${path}\0${hunkSeq}` -> [{ part, body, arrival, originalHeader }]
  let arrival = 0;
  for (const part of [...pieces, ...oversize]) {
    for (const file of parseUnifiedDiff(part.text)) {
      if (!byPath.has(file.path)) byPath.set(file.path, { path: file.path, header: file.header, binary: file.binary, hunks: [] });
      const entry = byPath.get(file.path);
      // Parts of one line-split hunk are gathered and restored below as the
      // ORIGINAL hunk: its recorded header plus the bodies in part order.
      if (part.lineSplit && file.hunks.length === 1) {
        const key = `${file.path}\0${part.lineSplit.hunkSeq}\0${part.lineSplit.originalHeader}`;
        if (!lineSplitParts.has(key)) lineSplitParts.set(key, []);
        lineSplitParts.get(key).push({ path: file.path, part: part.lineSplit.part, parts: part.lineSplit.parts, header: file.hunks[0].header, body: file.hunks[0].body, arrival: arrival++, originalHeader: part.lineSplit.originalHeader, hunkSeq: part.lineSplit.hunkSeq });
        continue;
      }
      const seqs = Array.isArray(part.hunkSeqs?.[file.path]) ? part.hunkSeqs[file.path] : Number.isInteger(part.hunkSeq) ? [part.hunkSeq] : [];
      file.hunks.forEach((h, i) => entry.hunks.push({ header: h.header, body: h.body, bytes: h.bytes, seq: Number.isInteger(seqs[i]) ? seqs[i] : null, arrival: arrival++ }));
    }
  }
  // A set is complete when parts 1..N each arrived exactly once. Anything else
  // (a lost piece, a retried piece delivered twice) is reported in `incomplete`
  // and its fragments stay the valid sub-hunks they are: the original header is
  // never claimed for a body that is not the original body.
  const incomplete = [];
  for (const parts of lineSplitParts.values()) {
    const ordered = parts.sort((a, b) => a.part - b.part || a.arrival - b.arrival);
    const total = ordered[0].parts, seen = ordered.map((p) => p.part);
    const expected = Number.isInteger(total) && total >= 2 ? Array.from({ length: total }, (_, i) => i + 1) : [];
    const missing = expected.filter((n) => !seen.includes(n));
    const duplicated = [...new Set(seen.filter((n, i) => seen.indexOf(n) !== i))];
    if (!expected.length || missing.length || duplicated.length || seen.some((n) => !expected.includes(n)) || ordered.some((p) => p.parts !== total)) {
      incomplete.push({ path: ordered[0].path, hunkSeq: ordered[0].hunkSeq, originalHeader: ordered[0].originalHeader, missing, duplicated });
      for (const p of ordered) byPath.get(p.path).hunks.push({ header: p.header, body: p.body, bytes: byteLength(p.header) + byteLength(p.body), seq: Number.isInteger(p.hunkSeq) ? p.hunkSeq : null, arrival: p.arrival });
      continue;
    }
    const body = ordered.map((p) => p.body).join("");
    const header = ordered[0].originalHeader;
    byPath.get(ordered[0].path).hunks.push({ header, body, bytes: byteLength(header) + byteLength(body), seq: Number.isInteger(ordered[0].hunkSeq) ? ordered[0].hunkSeq : null, arrival: ordered[0].arrival });
  }
  for (const entry of byPath.values()) {
    const known = entry.hunks.every((h) => h.seq !== null);
    entry.hunks.sort((a, b) => (known ? a.seq - b.seq : oldStart(a.header) - oldStart(b.header)) || a.arrival - b.arrival);
    entry.hunks = entry.hunks.map(({ header, body, bytes }) => ({ header, body, bytes }));
  }
  return { files: [...byPath.values()], incomplete };
}

// True when a candidate quote is made solely of diff header lines — the only
// text the splitter duplicates across pieces — so the parent merge can refuse
// to treat it as corroboration. Lines are classified by their RAW start: in a
// diff a leading space is the context marker, so " index abc" is file content
// that happens to resemble a header, and an indented "+++ b/x" is not a header
// either. Only empty lines are ignored.
// A deleted "-- text" line is stored as "--- text" and an added "++ text" as
// "+++ text": body, not header. So a ---/+++ line counts as a file header only
// in a form git writes (a/ b/ or a mnemonic prefix, optionally C-quoted, or
// /dev/null) or as half of a qualifying ---/+++ pair (diff.noprefix, below).
// Residual: a deleted line that itself reads "-- a/…" is indistinguishable from a header.
const FILE_SIDE = /^(?:--- |\+\+\+ )(?:"?[abciow]\/|\/dev\/null(?:\t|$))/;
// A ---/+++ pair WITHOUT a git prefix (diff.noprefix) is a header only when both lines name
// one path (timestamps aside) or the pair directly follows a header block line (diff --git,
// index, mode, similarity, rename). A bare adjacent pair is not enough: a deleted "-- old"
// next to an added "++ new" is body. Residual: such a pair with IDENTICAL text reads as a header.
const sidePath = (l) => l.slice(4).replace(/\t.*$/, "");
const BLOCK_LINE = (l) => l !== undefined && HEADER_LINE.test(l) && !/^(?:--- |\+\+\+ |@@ )/.test(l);
export function headerOnlyQuote(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l !== "");
  const pairAt = (i) => Boolean(lines[i]?.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ") && (BLOCK_LINE(lines[i - 1]) || sidePath(lines[i]) === sidePath(lines[i + 1])));
  return lines.length > 0 && lines.every((l, i) => {
    if (l.startsWith("--- ")) return FILE_SIDE.test(l) || pairAt(i);
    if (l.startsWith("+++ ")) return FILE_SIDE.test(l) || pairAt(i - 1);
    return HEADER_LINE.test(l);
  });
}
