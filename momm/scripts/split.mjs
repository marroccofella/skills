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

function pathOf(headerLines) {
  const plain = headerLines.map(stripEol);
  for (const line of plain) {
    if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) return line.slice(4).replace(/^b\//, "").replace(/\t.*$/, "");
  }
  for (const line of plain) if (line.startsWith("rename to ")) return line.slice("rename to ".length);
  for (const line of plain) {
    if (line.startsWith("--- ") && !line.startsWith("--- /dev/null")) return line.slice(4).replace(/^a\//, "").replace(/\t.*$/, "");
  }
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(plain[0] || "");
  return match ? match[2] : (plain[0] || "").replace(/^diff --git /, "");
}

export function parseUnifiedDiff(text) {
  const lines = splitLines(String(text ?? ""));
  const files = [];
  let file = null;
  let hunk = null;
  const closeHunk = () => {
    if (!hunk) return;
    hunk.bytes = byteLength(hunk.header) + byteLength(hunk.body);
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
      hunk = { header: line, body: "", bytes: 0 };
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
// where each chunk/oversize text starts with the file header.
function splitFile(file, ceiling) {
  const chunks = [];
  const oversize = [];
  const headerBytes = byteLength(file.header);
  if (!file.hunks.length) {
    oversize.push({ path: file.path, hunkHeader: null, bytes: file.bytes, text: file.text });
    return { chunks, oversize };
  }
  let current = null;
  const flush = () => {
    if (current) chunks.push({ files: [file.path], text: file.header + current.text, bytes: headerBytes + current.bytes, order: file.order, seq: chunks.length });
    current = null;
  };
  for (const hunk of file.hunks) {
    if (headerBytes + hunk.bytes > ceiling) {
      // Sibling hunks either side of an oversize hunk keep sharing a chunk:
      // hunks stay in ascending line order, so the chunk is still a valid diff.
      oversize.push({ path: file.path, hunkHeader: stripEol(hunk.header), bytes: headerBytes + hunk.bytes, text: file.header + hunk.header + hunk.body });
      continue;
    }
    if (current && current.bytes + hunk.bytes + headerBytes > ceiling) flush();
    if (!current) current = { text: "", bytes: 0 };
    current.text += hunk.header + hunk.body;
    current.bytes += hunk.bytes;
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
    return { files: ordered.map((u) => u.path), text: ordered.map((u) => u.text).join(""), bytes: bin.bytes, order: ordered[0].order, seq: 0 };
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
  const pieces = rawPieces.map((p, i) => ({ id: padId("piece", i + 1, rawPieces.length), files: p.files, text: p.text, bytes: p.bytes, oversize: false }));
  const oversizeOut = oversize.map((o, i) => ({ id: padId("oversize", i + 1, oversize.length), path: o.path, hunkHeader: o.hunkHeader, bytes: o.bytes, text: o.text }));
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
// oversize entries. Hunks of a file are ordered by their old-side start line,
// which is the order git emits them, so a file whose hunks were scattered
// across pieces and oversize entries comes back in its original order.
export function reassemble(pieces = [], oversize = []) {
  const byPath = new Map();
  for (const part of [...pieces, ...oversize]) {
    for (const file of parseUnifiedDiff(part.text)) {
      if (!byPath.has(file.path)) byPath.set(file.path, { path: file.path, header: file.header, binary: file.binary, hunks: [] });
      const entry = byPath.get(file.path);
      entry.hunks.push(...file.hunks.map((h, i) => ({ header: h.header, body: h.body, bytes: h.bytes, seq: i })));
    }
  }
  for (const entry of byPath.values()) {
    entry.hunks.sort((a, b) => oldStart(a.header) - oldStart(b.header));
    entry.hunks.forEach((h) => delete h.seq);
  }
  return { files: [...byPath.values()] };
}

// True when a candidate quote is made solely of diff header lines — the only
// text the splitter duplicates across pieces — so the parent merge can refuse
// to treat it as corroboration.
export function headerOnlyQuote(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => HEADER_LINE.test(l));
}
