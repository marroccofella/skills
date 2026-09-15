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
//      hunk > ceiling) is never line-split: it becomes an `oversize` entry
//      (with its file header, so it too is a valid diff) and is excluded from
//      `pieces`. Nothing is ever dropped.
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
function splitFile(file, ceiling) {
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

export function splitDiff(text, { ceilingBytes, minCeilingBytes = 4096 } = {}) {
  if (!Number.isFinite(ceilingBytes) || ceilingBytes <= 0) throw new TypeError("splitDiff: ceilingBytes must be a positive number");
  const ceiling = Math.max(Math.floor(ceilingBytes), Math.floor(minCeilingBytes));
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
    const split = splitFile(file, ceiling);
    rawPieces.push(...split.chunks);
    oversize.push(...split.oversize.map((o) => ({ ...o, order: file.order })));
  }
  rawPieces.push(...packUnits(units, ceiling));
  rawPieces.sort((a, b) => a.order - b.order || a.seq - b.seq);
  oversize.sort((a, b) => a.order - b.order);
  const pieces = rawPieces.map((p, i) => ({ id: padId("piece", i + 1, rawPieces.length), files: p.files, text: p.text, bytes: p.bytes, oversize: false, hunkSeqs: p.hunkSeqs }));
  const oversizeOut = oversize.map((o, i) => ({ id: padId("oversize", i + 1, oversize.length), path: o.path, hunkHeader: o.hunkHeader, hunkSeq: o.hunkSeq, bytes: o.bytes, text: o.text }));
  const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
  return {
    pieces,
    oversize: oversizeOut,
    stats: { files: files.length, hunks, pieces: pieces.length, oversize: oversizeOut.length, filesOverCeiling: filesOver, ceiling },
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
  let arrival = 0;
  for (const part of [...pieces, ...oversize]) {
    for (const file of parseUnifiedDiff(part.text)) {
      if (!byPath.has(file.path)) byPath.set(file.path, { path: file.path, header: file.header, binary: file.binary, hunks: [] });
      const entry = byPath.get(file.path);
      const seqs = Array.isArray(part.hunkSeqs?.[file.path]) ? part.hunkSeqs[file.path] : Number.isInteger(part.hunkSeq) ? [part.hunkSeq] : [];
      file.hunks.forEach((h, i) => entry.hunks.push({ header: h.header, body: h.body, bytes: h.bytes, seq: Number.isInteger(seqs[i]) ? seqs[i] : null, arrival: arrival++ }));
    }
  }
  for (const entry of byPath.values()) {
    const known = entry.hunks.every((h) => h.seq !== null);
    entry.hunks.sort((a, b) => (known ? a.seq - b.seq : oldStart(a.header) - oldStart(b.header)) || a.arrival - b.arrival);
    entry.hunks = entry.hunks.map(({ header, body, bytes }) => ({ header, body, bytes }));
  }
  return { files: [...byPath.values()] };
}

// True when a candidate quote is made solely of diff header lines — the only
// text the splitter duplicates across pieces — so the parent merge can refuse
// to treat it as corroboration. Lines are classified by their RAW start: in a
// diff a leading space is the context marker, so " index abc" is file content
// that happens to resemble a header, and an indented "+++ b/x" is not a header
// either. Only empty lines are ignored.
export function headerOnlyQuote(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l !== "");
  return lines.length > 0 && lines.every((l) => HEADER_LINE.test(l));
}
