// Tests for split.mjs (MOMM 1.16.0 E5). Run: node momm/scripts/split.test.mjs
import assert from "node:assert/strict";
import { parseUnifiedDiff, splitDiff, reassemble, headerOnlyQuote, lineSplitHunk } from "./split.mjs";

const failures = [], passed = [];
function test(name, fn) {
  try { fn(); passed.push(name); } catch (e) { failures.push({ test: name, error: e.message }); }
}
const bytes = (s) => Buffer.byteLength(s, "utf8");
const LOOKS_LIKE_DIFF = /^(?:diff --git |--- a\/|\+\+\+ b\/|@@ )/m; // mirrors looksLikeDiff in multi-review.mjs

// ---- synthetic diff builders -------------------------------------------------
function header(path, extra = []) {
  return [`diff --git a/${path} b/${path}`, `index 1111111..2222222 100644`, ...extra, `--- a/${path}`, `+++ b/${path}`];
}
function hunk(oldStart, lineCount, tag, lineWidth = 40) {
  const lines = [`@@ -${oldStart},${lineCount} +${oldStart},${lineCount + 1} @@ function ${tag}()`];
  for (let i = 0; i < lineCount; i += 1) lines.push(` ${tag}_ctx_${i}_${"x".repeat(lineWidth)}`);
  lines.push(`+${tag}_added_${"y".repeat(lineWidth)}`);
  return lines;
}
function fileWithHunks(path, hunks) {
  return [...header(path), ...hunks.flat()];
}
const CEILING = 4096;
function buildFixture() {
  const lines = [];
  lines.push("src/a/Makefile | 2 +-", " 1 file changed"); // stat preamble, not a file
  const dirs = ["src/a", "src/b", "lib/c"];
  for (const dir of dirs) for (let i = 0; i < 4; i += 1) lines.push(...fileWithHunks(`${dir}/file${i}.js`, [hunk(10 + i, 8 + i, `${dir.replace("/", "_")}${i}`)]));
  // one file over the ceiling with several hunks (each ~1.1 KB)
  lines.push(...fileWithHunks("big/large.js", [0, 1, 2, 3, 4, 5, 6, 7].map((n) => hunk(100 * (n + 1), 22, `large${n}`))));
  // one hunk larger than the ceiling, plus a small hunk before and after it
  lines.push(...fileWithHunks("big/huge.js", [hunk(5, 6, "hugeA"), hunk(500, 140, "hugeB"), hunk(9000, 6, "hugeC")]));
  // binary, rename without hunks, mode-only change
  lines.push("diff --git a/img/logo.png b/img/logo.png", "index 3333333..4444444 100644", "Binary files a/img/logo.png and b/img/logo.png differ");
  lines.push("diff --git a/src/a/old.js b/src/a/new.js", "similarity index 100%", "rename from src/a/old.js", "rename to src/a/new.js");
  lines.push("diff --git a/bin/run.sh b/bin/run.sh", "old mode 100644", "new mode 100755");
  // "\ No newline at end of file" belongs to the preceding hunk
  lines.push(...header("src/b/tail.txt"), "@@ -1,2 +1,2 @@", " keep", "-old last", "\\ No newline at end of file", "+new last", "\\ No newline at end of file");
  return lines.join("\n") + "\n";
}
const LF = buildFixture();
const CRLF = LF.replace(/\n/g, "\r\n");

// ---- parser ------------------------------------------------------------------
test("parseUnifiedDiff: files, hunks, binary, rename, mode-only, no-newline marker", () => {
  const files = parseUnifiedDiff(LF);
  assert.equal(files.length, 12 + 2 + 3 + 1);
  const byPath = new Map(files.map((f) => [f.path, f]));
  assert.equal(byPath.get("big/large.js").hunks.length, 8);
  assert.equal(byPath.get("img/logo.png").binary, true);
  assert.equal(byPath.get("img/logo.png").hunks.length, 0);
  assert.equal(byPath.get("src/a/new.js").hunks.length, 0);
  assert.match(byPath.get("src/a/new.js").header, /rename to src\/a\/new\.js/);
  assert.equal(byPath.get("bin/run.sh").hunks.length, 0);
  assert.match(byPath.get("bin/run.sh").header, /new mode 100755/);
  const tail = byPath.get("src/b/tail.txt");
  assert.equal(tail.hunks.length, 1);
  assert.equal(tail.hunks[0].body, " keep\n-old last\n\\ No newline at end of file\n+new last\n\\ No newline at end of file\n");
  assert.equal(tail.header, "diff --git a/src/b/tail.txt b/src/b/tail.txt\nindex 1111111..2222222 100644\n--- a/src/b/tail.txt\n+++ b/src/b/tail.txt\n");
  for (const f of files) { assert.equal(f.bytes, bytes(f.text)); for (const h of f.hunks) assert.equal(h.bytes, bytes(h.header + h.body)); }
  assert.equal(files.map((f) => f.text).join(""), LF.slice(LF.indexOf("diff --git ")));
});
test("parseUnifiedDiff: CRLF preserved as-is", () => {
  const files = parseUnifiedDiff(CRLF);
  assert.equal(files.map((f) => f.text).join(""), CRLF.slice(CRLF.indexOf("diff --git ")));
  assert.equal(files[0].path, "src/a/file0.js");
  assert.ok(files[0].hunks[0].header.endsWith("\r\n"));
});

// ---- splitter ----------------------------------------------------------------
function checkSplit(source, label) {
  const files = parseUnifiedDiff(source);
  const result = splitDiff(source, { ceilingBytes: CEILING });
  const { pieces, oversize, stats } = result;
  test(`${label}: every piece starts with diff --git and looks like a diff`, () => {
    assert.ok(pieces.length > 0);
    for (const p of pieces) { assert.ok(p.text.startsWith("diff --git "), p.id); assert.match(p.text, LOOKS_LIKE_DIFF); assert.ok(p.files.length > 0); assert.equal(p.oversize, false); }
    for (const o of oversize) assert.ok(o.text.startsWith("diff --git "), o.id);
  });
  test(`${label}: no piece exceeds the ceiling; bytes are accurate`, () => {
    for (const p of pieces) { assert.equal(p.bytes, bytes(p.text)); assert.ok(p.bytes <= CEILING, `${p.id} ${p.bytes}`); }
  });
  test(`${label}: the over-ceiling hunk is in oversize, unsplit, with its header`, () => {
    assert.equal(oversize.length, 1);
    const o = oversize[0];
    assert.equal(o.path, "big/huge.js");
    assert.match(o.hunkHeader, /^@@ -500,140 \+500,141 @@/);
    assert.ok(o.bytes > CEILING);
    assert.equal(o.bytes, bytes(o.text));
    const huge = files.find((f) => f.path === "big/huge.js");
    assert.equal(o.text, huge.header + huge.hunks[1].header + huge.hunks[1].body);
    assert.ok(!pieces.some((p) => p.text.includes("hugeB_ctx_0")), "oversize hunk must not appear in pieces");
  });
  test(`${label}: piece count bound`, () => {
    const total = files.reduce((n, f) => n + f.bytes, 0);
    const filesOver = files.filter((f) => f.bytes > CEILING).length;
    const dirGroups = new Set(files.map((f) => f.path.slice(0, f.path.lastIndexOf("/")))).size;
    const bound = Math.ceil(total / CEILING) + filesOver + dirGroups;
    assert.ok(pieces.length <= bound, `${pieces.length} pieces > bound ${bound}`);
    assert.ok(pieces.length >= Math.ceil((total - oversize[0].bytes) / CEILING));
    assert.deepEqual({ files: stats.files, hunks: stats.hunks, pieces: stats.pieces, oversize: stats.oversize }, { files: files.length, hunks: files.reduce((n, f) => n + f.hunks.length, 0), pieces: pieces.length, oversize: oversize.length });
  });
  test(`${label}: split file repeats header verbatim on every piece, header only`, () => {
    const large = files.find((f) => f.path === "big/large.js");
    const chunks = pieces.filter((p) => p.files.includes("big/large.js"));
    assert.ok(chunks.length >= 2, "large.js should span several pieces");
    for (const c of chunks) { assert.deepEqual(c.files, ["big/large.js"]); assert.ok(c.text.startsWith(large.header)); }
    const rebuilt = chunks.map((c) => c.text.slice(large.header.length)).join("");
    assert.equal(rebuilt, large.hunks.map((h) => h.header + h.body).join(""));
  });
  test(`${label}: whole files never split — every under-ceiling file sits verbatim in exactly one piece`, () => {
    const under = files.filter((f) => f.bytes <= CEILING);
    assert.ok(under.length >= 10, "fixture must carry under-ceiling files");
    for (const f of under) {
      const holders = pieces.filter((p) => p.files.includes(f.path));
      assert.equal(holders.length, 1, `${f.path} must sit in exactly one piece`);
      const parsed = parseUnifiedDiff(holders[0].text).find((x) => x.path === f.path);
      assert.ok(parsed, `${f.path} missing from ${holders[0].id}`);
      assert.equal(parsed.hunks.length, f.hunks.length, `${f.path} lost hunks`);
      assert.equal(parsed.text, f.text, `${f.path} must be carried verbatim`);
    }
    for (const p of pieces) for (const path of p.files) assert.ok(files.some((f) => f.path === path), `${p.id} names unknown path ${path}`);
    const dirOf = (path) => pieces.find((p) => p.files.includes(path)).id;
    assert.equal(dirOf("lib/c/file0.js"), dirOf("lib/c/file1.js"));
  });
  test(`${label}: reassemble is byte-exact and order-preserving within a file`, () => {
    const back = reassemble(pieces, oversize);
    assert.equal(back.files.length, files.length);
    for (const f of files) {
      const r = back.files.find((x) => x.path === f.path);
      assert.ok(r, f.path);
      assert.equal(r.header, f.header);
      assert.equal(r.binary, f.binary);
      assert.deepEqual(r.hunks.map((h) => h.header + h.body), f.hunks.map((h) => h.header + h.body));
    }
  });
  test(`${label}: deterministic`, () => {
    assert.deepEqual(splitDiff(source, { ceilingBytes: CEILING }), result);
  });
}
checkSplit(LF, "LF");
checkSplit(CRLF, "CRLF");

test("splitDiff: ceiling floored at minCeilingBytes; invalid ceiling rejected", () => {
  assert.equal(splitDiff(LF, { ceilingBytes: 100 }).stats.ceiling, 4096);
  assert.equal(splitDiff(LF, { ceilingBytes: 100, minCeilingBytes: 512 }).stats.ceiling, 512);
  assert.throws(() => splitDiff(LF, {}), TypeError);
});
test("splitDiff: small input is a single piece and empty input yields none", () => {
  const one = fileWithHunks("x.js", [hunk(1, 3, "solo")]).join("\n") + "\n";
  const r = splitDiff(one, { ceilingBytes: CEILING });
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].text, one);
  assert.equal(r.pieces[0].id, "piece-01");
  assert.deepEqual(splitDiff("", { ceilingBytes: CEILING }).pieces, []);
});
test("splitDiff: missing trailing newline is restored so pieces stay valid", () => {
  const r = splitDiff(LF.trimEnd(), { ceilingBytes: CEILING });
  assert.deepEqual(r, splitDiff(LF, { ceilingBytes: CEILING }));
});
test("splitDiff: hunk-less oversize file (binary patch) lands in oversize, never dropped", () => {
  const blob = ["diff --git a/blob.bin b/blob.bin", "index 1..2 100644", "GIT binary patch", "literal 9000", ...Array.from({ length: 200 }, (_, i) => `z${"A".repeat(50)}${i}`), ""].join("\n");
  const r = splitDiff(blob, { ceilingBytes: CEILING });
  assert.equal(r.pieces.length, 0);
  assert.equal(r.oversize.length, 1);
  assert.equal(r.oversize[0].hunkHeader, null);
  assert.equal(r.oversize[0].text, blob);
  assert.equal(reassemble([], r.oversize).files[0].binary, true);
});

// ---- header-only quotes --------------------------------------------------------
test("headerOnlyQuote: true for header-only text", () => {
  assert.equal(headerOnlyQuote("diff --git a/x b/x\nindex 1111111..2222222 100644\n--- a/x\n+++ b/x"), true);
  assert.equal(headerOnlyQuote("@@ -1,3 +1,4 @@ function f()"), true);
  assert.equal(headerOnlyQuote("+++ b/src/a.js\r\n--- a/src/a.js\r\n"), true);
  assert.equal(headerOnlyQuote("new file mode 100644\nrename from a\nrename to b"), true);
  assert.equal(headerOnlyQuote("\n\n@@ -1 +1 @@\n"), true); // empty lines are ignored, not classified
});
test("headerOnlyQuote: classifies by raw line start — context and indented body lines are content", () => {
  assert.equal(headerOnlyQuote(" index abc"), false); // a context line whose source text happens to look like a header
  assert.equal(headerOnlyQuote(" const x = 1;"), false);
  assert.equal(headerOnlyQuote("  +const x = 1;"), false);
  assert.equal(headerOnlyQuote("  -const x = 1;"), false);
  assert.equal(headerOnlyQuote(" diff --git a/x b/x"), false);
  assert.equal(headerOnlyQuote("  +++ b/src/a.js\r\n  --- a/src/a.js\r\n"), false); // indented: a leading space is a context marker
  assert.equal(headerOnlyQuote("@@ -1 +1 @@\n index abc"), false);
});
test("headerOnlyQuote: false for code or mixed text", () => {
  assert.equal(headerOnlyQuote("+const x = 1;"), false);
  assert.equal(headerOnlyQuote("diff --git a/x b/x\n+const x = 1;"), false);
  assert.equal(headerOnlyQuote("--- a/x\n missing semicolon here"), false);
  assert.equal(headerOnlyQuote(""), false);
  assert.equal(headerOnlyQuote(null), false);
  assert.equal(headerOnlyQuote("---"), false);
});


// ---- packing: affinity must beat diff-order greedy -----------------------------
test("splitDiff: directory affinity beats diff-order greedy packing", () => {
  // Interleaved directories, each file between a third and a half of the
  // ceiling: greedy first-fit in diff order pairs x/one with y/one; directory
  // grouping must pair x/one with x/two.
  const src = ["x/one.js", "y/one.js", "x/two.js", "y/two.js"].map((p, i) => fileWithHunks(p, [hunk(1, 30, `f${i}`)])).flat().join("\n") + "\n";
  const files = parseUnifiedDiff(src);
  for (const f of files) assert.ok(f.bytes > CEILING / 3 && f.bytes < CEILING / 2, `${f.path} ${f.bytes}`);
  const greedy = [];
  for (const f of files) { const bin = greedy.find((b) => b.bytes + f.bytes <= CEILING); if (bin) { bin.files.push(f.path); bin.bytes += f.bytes; } else greedy.push({ files: [f.path], bytes: f.bytes }); }
  assert.ok(greedy.some((b) => b.files.includes("x/one.js") && b.files.includes("y/one.js")), "fixture must discriminate: a greedy packer pairs x/one with y/one");
  const { pieces } = splitDiff(src, { ceilingBytes: CEILING });
  const pieceOf = (path) => pieces.find((p) => p.files.includes(path)).id;
  assert.equal(pieces.length, 2);
  assert.equal(pieceOf("x/one.js"), pieceOf("x/two.js"));
  assert.equal(pieceOf("y/one.js"), pieceOf("y/two.js"));
  assert.notEqual(pieceOf("x/one.js"), pieceOf("y/one.js"));
  assert.deepEqual(pieces.map((p) => p.files), [["x/one.js", "x/two.js"], ["y/one.js", "y/two.js"]]); // piece order follows the first file's diff position
});

// ---- reassemble order ----------------------------------------------------------
test("reassemble: hunk order follows the original diff even when old-start lines tie", () => {
  // Hunk B (oversize) and hunk C share an old-side start line. C rides in a
  // piece and B in oversize, so ordering by oldStart alone would yield A, C, B.
  const A = hunk(10, 3, "A"), B = hunk(20, 140, "B"), C = ["@@ -20,3 +170,4 @@ function C()", " C_ctx_0", " C_ctx_1", " C_ctx_2", "+C_added"];
  const src = fileWithHunks("src/tie.js", [A, B, C]).join("\n") + "\n";
  const original = parseUnifiedDiff(src)[0];
  assert.equal(original.hunks.length, 3);
  const { pieces, oversize } = splitDiff(src, { ceilingBytes: CEILING });
  assert.equal(oversize.length, 1);
  assert.match(oversize[0].hunkHeader, /^@@ -20,140 /);
  assert.equal(pieces.length, 1);
  const back = reassemble(pieces, oversize).files[0];
  assert.deepEqual(back.hunks.map((h) => h.header), original.hunks.map((h) => h.header));
  assert.deepEqual(back.hunks.map((h) => h.header + h.body), original.hunks.map((h) => h.header + h.body));
  assert.ok(back.hunks.every((h) => !("seq" in h)), "seq is internal bookkeeping");
});

// ---- git C-style path quoting ------------------------------------------------------
test("parseUnifiedDiff: git C-quoted paths are decoded and the a/ b/ prefix stripped", () => {
  const src = [
    // written as git prints them: quotes, \t, octal UTF-8 bytes, \" and \\ escapes
    "diff --git \"a/dir/a\\tb.txt\" \"b/dir/a\\tb.txt\"", "index 1111111..2222222 100644", "--- \"a/dir/a\\tb.txt\"", "+++ \"b/dir/a\\tb.txt\"", "@@ -1 +1 @@", "-x", "+y",
    "diff --git \"a/caf\\303\\251 \\\"q\\\".js\" \"b/caf\\303\\251 \\\"q\\\".js\"", "index 1111111..2222222 100644", "--- \"a/caf\\303\\251 \\\"q\\\".js\"", "+++ \"b/caf\\303\\251 \\\"q\\\".js\"", "@@ -1 +1 @@", "-x", "+y",
    "diff --git \"a/back\\\\slash\\n.txt\" \"b/back\\\\slash\\n.txt\"", "new file mode 100644", "--- /dev/null", "+++ \"b/back\\\\slash\\n.txt\"", "@@ -0,0 +1 @@", "+y",
    "diff --git \"a/old\\tname.txt\" \"b/new\\tname.txt\"", "similarity index 100%", "rename from \"old\\tname.txt\"", "rename to \"new\\tname.txt\"",
    "diff --git \"a/only header.txt\" \"b/only header.txt\"", "old mode 100644", "new mode 100755",
    "diff --git a/plain.txt b/plain.txt", "--- a/plain.txt\t2026-09-13 10:00:00", "+++ b/plain.txt\t2026-09-13 10:00:01", "@@ -1 +1 @@", "-x", "+y",
  ].join("\n") + "\n";
  const expected = ["dir/a\tb.txt", "café \"q\".js", "back\\slash\n.txt", "new\tname.txt", "only header.txt", "plain.txt"];
  assert.deepEqual(parseUnifiedDiff(src).map((f) => f.path), expected);
  // splitDiff and reassemble carry the decoded path
  const r = splitDiff(src, { ceilingBytes: CEILING });
  assert.deepEqual(r.pieces.flatMap((p) => p.files), expected);
  assert.deepEqual(reassemble(r.pieces, r.oversize).files.map((f) => f.path), expected);
  assert.equal(r.pieces.map((p) => p.text).join(""), src, "decoding never rewrites the diff text");
});

// ---- rule 2b: line-splitting an over-ceiling hunk (opt-in) --------------------
// The defect this closes: a whole new file larger than the ceiling is ONE hunk,
// so under rule 2 no route ever read it and full-source peer quorum could not
// be met. With lineSplit the hunk becomes consecutive valid sub-hunks.
const HUNK_RANGE = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/;
const hunkTexts = (files, path) => files.find((f) => f.path === path).hunks.map((h) => h.header + h.body);
function newFileDiff(path, lineCount, { eol = "\n", width = 60, noFinalNewline = false } = {}) {
  const lines = [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0000000..1111111", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${lineCount} @@`];
  for (let i = 1; i <= lineCount; i += 1) lines.push(`+line_${i}_${"z".repeat(width)}`);
  if (noFinalNewline) lines.push("\\ No newline at end of file");
  return lines.join(eol) + eol;
}
function rangesOf(piece) {
  const hunks = parseUnifiedDiff(piece.text)[0].hunks;
  assert.equal(hunks.length, 1, `${piece.id} carries exactly one hunk`);
  const m = HUNK_RANGE.exec(hunks[0].header);
  assert.ok(m, `${piece.id} has a well-formed range: ${hunks[0].header}`);
  return { oldStart: +m[1], oldLen: +m[2], newStart: +m[3], newLen: +m[4], header: hunks[0].header, body: hunks[0].body, lines: hunks[0].body.split(/\r?\n/).filter((l) => l && !l.startsWith("\\")) };
}

test("lineSplit: a whole new file over the ceiling becomes contiguous valid sub-hunks; nothing is left governor_direct", () => {
  const src = newFileDiff("src/big.mjs", 900);
  assert.ok(bytes(src) > CEILING * 8);
  const before = splitDiff(src, { ceilingBytes: CEILING });
  assert.equal(before.oversize.length, 1, "the library default keeps rule 2: the hunk is oversize");
  assert.equal(before.pieces.length, 0);
  assert.equal(before.stats.lineSplitHunks, 0);
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.oversize.length, 0);
  assert.ok(r.pieces.length >= 8);
  assert.equal(r.stats.lineSplitHunks, 1);
  assert.equal(r.stats.lineSplitPieces, r.pieces.length);
  let nextNew = 1;
  r.pieces.forEach((p, i) => {
    assert.ok(p.bytes <= CEILING, `${p.id} is ${p.bytes} bytes`);
    assert.equal(bytes(p.text), p.bytes, `${p.id} reports its true size`);
    assert.ok(p.text.startsWith("diff --git a/src/big.mjs "), `${p.id} starts with the file header`);
    assert.match(p.text, LOOKS_LIKE_DIFF);
    assert.deepEqual({ part: p.lineSplit.part, parts: p.lineSplit.parts, path: p.lineSplit.path }, { part: i + 1, parts: r.pieces.length, path: "src/big.mjs" });
    const g = rangesOf(p);
    assert.deepEqual([g.oldStart, g.oldLen], [0, 0], "the old side of a new file stays empty");
    assert.equal(g.newStart, nextNew, `${p.id} continues where the previous part ended`);
    assert.equal(g.lines.length, g.newLen, "the header's length matches the lines it carries");
    assert.equal(g.lines[0], `+line_${nextNew}_${"z".repeat(60)}`, "the first line is the one the header names");
    nextNew += g.newLen;
  });
  assert.equal(nextNew - 1, 900, "the ranges cover 900 lines");
  assert.deepEqual(r.pieces.flatMap((p) => rangesOf(p).lines), Array.from({ length: 900 }, (_, i) => `+line_${i + 1}_${"z".repeat(60)}`), "every line appears exactly once, in order, interior lines included");
});
test("lineSplit: reassemble restores the original hunk byte for byte beside untouched files", () => {
  const src = newFileDiff("src/big.mjs", 700) + fileWithHunks("src/small.js", [hunk(3, 4, "small")]).join("\n") + "\n";
  const original = parseUnifiedDiff(src);
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  const back = reassemble(r.pieces, r.oversize).files;
  assert.deepEqual(back.map((f) => f.path).sort(), original.map((f) => f.path).sort());
  for (const f of original) assert.deepEqual(hunkTexts(back, f.path), f.hunks.map((h) => h.header + h.body), f.path);
  const shuffled = [...r.pieces].reverse();
  assert.deepEqual(hunkTexts(reassemble(shuffled, r.oversize).files, "src/big.mjs"), hunkTexts(original, "src/big.mjs"), "part order, not arrival order, decides the body");
});
test("lineSplit: a modification hunk keeps both sides' counts, continuity and section heading", () => {
  const body = [];
  for (let i = 0; i < 300; i += 1) {
    body.push(` ctx_${i}_${"c".repeat(30)}`);
    if (i % 3 === 0) body.push(`-old_${i}_${"o".repeat(30)}`);
    if (i % 4 === 0) body.push(`+new_${i}_${"n".repeat(30)}`);
  }
  const oldLen = body.filter((l) => l[0] !== "+").length, newLen = body.filter((l) => l[0] !== "-").length;
  const src = [...header("src/mod.js"), `@@ -40,${oldLen} +44,${newLen} @@ function big()`, ...body].join("\n") + "\n";
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.oversize.length, 0);
  assert.ok(r.pieces.length >= 3);
  let oldNext = 40, newNext = 44;
  for (const p of r.pieces) {
    const g = rangesOf(p);
    assert.equal(g.lines.filter((l) => l[0] !== "+").length, g.oldLen, `${p.id} old length`);
    assert.equal(g.lines.filter((l) => l[0] !== "-").length, g.newLen, `${p.id} new length`);
    assert.equal(g.oldLen ? g.oldStart : g.oldStart + 1, oldNext, `${p.id} old side is contiguous`);
    assert.equal(g.newLen ? g.newStart : g.newStart + 1, newNext, `${p.id} new side is contiguous`);
    assert.match(g.header, / @@ function big\(\)/, "the section heading rides with every part");
    oldNext += g.oldLen; newNext += g.newLen;
  }
  assert.deepEqual([oldNext - 40, newNext - 44], [oldLen, newLen]);
  assert.deepEqual(hunkTexts(reassemble(r.pieces, r.oversize).files, "src/mod.js"), hunkTexts(parseUnifiedDiff(src), "src/mod.js"));
});
test("lineSplit: CRLF text and a no-newline marker survive; the marker never starts a part and is never counted", () => {
  const src = newFileDiff("src/crlf.txt", 400, { eol: "\r\n", noFinalNewline: true });
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.oversize.length, 0);
  let total = 0;
  for (const p of r.pieces) {
    const g = rangesOf(p);
    assert.ok(!g.body.startsWith("\\"), `${p.id} starts with a marker`);
    assert.ok(g.header.endsWith("\r\n"), `${p.id} keeps the artifact's line ending in its header`);
    assert.equal(g.lines.length, g.newLen, `${p.id} does not count the marker as a line`);
    total += g.newLen;
  }
  assert.equal(total, 400);
  const last = rangesOf(r.pieces[r.pieces.length - 1]);
  assert.ok(last.body.endsWith("\\ No newline at end of file\r\n"));
  assert.ok(last.body.includes("+line_400_"), "the marker stays with the line it annotates");
  assert.deepEqual(hunkTexts(reassemble(r.pieces, r.oversize).files, "src/crlf.txt"), hunkTexts(parseUnifiedDiff(src), "src/crlf.txt"));
});
test("lineSplit: one line that cannot fit sends the whole hunk to oversize, never a fragment", () => {
  const src = [...header("src/min.js"), "@@ -1,2 +1,3 @@", " keep", `+${"m".repeat(CEILING * 2)}`, " tail"].join("\n") + "\n";
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.pieces.length, 0);
  assert.equal(r.oversize.length, 1);
  assert.equal(r.oversize[0].text, src);
  assert.equal(r.stats.lineSplitHunks, 0);
  const parsed = parseUnifiedDiff(src)[0];
  assert.equal(lineSplitHunk(parsed.header, parsed.hunks[0], CEILING), null);
  assert.equal(lineSplitHunk("x\n", { header: "@@ not a range @@\n", body: "+a\n+b\n" }, CEILING), null, "an unparseable header is never guessed at");
  assert.equal(lineSplitHunk("x\n", { header: "@@ -1,1 +1,2 @@\n", body: " a\n+b\n" }, CEILING), null, "a hunk that fits in one part is not a split");
});
test("lineSplit: siblings of a divided hunk keep their place and other files are untouched", () => {
  const big = [];
  for (let i = 0; i < 200; i += 1) big.push(`+big_${i}_${"b".repeat(40)}`);
  const src = [...header("src/mix.js"), ...hunk(2, 3, "first"), `@@ -20,0 +21,${big.length} @@`, ...big, ...hunk(400, 3, "last"), ...fileWithHunks("src/other.js", [hunk(1, 2, "other")])].join("\n") + "\n";
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.oversize.length, 0);
  assert.equal(r.stats.lineSplitHunks, 1);
  const parts = r.pieces.filter((p) => p.lineSplit);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.files.length === 1 && p.files[0] === "src/mix.js"), "a part is never packed with anything else");
  assert.ok(parts.every((p) => p.lineSplit.hunkSeq === 1), "hunkSeq is the zero-based position in the file: the divided hunk is the second");
  assert.ok(r.pieces.some((p) => !p.lineSplit && p.text.includes("first_ctx_0")));
  assert.ok(r.pieces.some((p) => !p.lineSplit && p.text.includes("last_ctx_0")));
  assert.ok(r.pieces.some((p) => !p.lineSplit && p.files.includes("src/other.js")));
  const back = reassemble(r.pieces, r.oversize).files, original = parseUnifiedDiff(src);
  assert.deepEqual(hunkTexts(back, "src/mix.js"), hunkTexts(original, "src/mix.js"), "first, the divided hunk, last - in source order");
  assert.deepEqual(hunkTexts(back, "src/other.js"), hunkTexts(original, "src/other.js"));
});

// ---- review rev_20260918174726_lc1e: reproduced before each fix -----------------
test("lineSplit: a multi-byte section heading and very large line numbers never push a part over the ceiling", () => {
  const wide = String.fromCodePoint(0x3042).repeat(60); // 60 UTF-16 units, 180 UTF-8 bytes
  const body = []; for (let i = 0; i < 400; i += 1) body.push(`+row_${i}_${"w".repeat(50)}`);
  const src = [...header("src/wide.js"), `@@ -2147483000,0 +2147483001,${body.length} @@ ${wide}`, ...body].join("\n") + "\n";
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.equal(r.oversize.length, 0);
  assert.ok(r.pieces.length >= 2);
  for (const p of r.pieces) { assert.ok(p.bytes <= CEILING, `${p.id} is ${p.bytes} bytes`); assert.equal(bytes(p.text), p.bytes); assert.ok(!p.text.includes(String.fromCharCode(0xFFFD)), "a clipped heading never ends in half a character"); }
  assert.deepEqual(hunkTexts(reassemble(r.pieces, r.oversize).files, "src/wide.js"), hunkTexts(parseUnifiedDiff(src), "src/wide.js"));
});
test("reassemble: parts of different assemblies that share a path and position are never concatenated", () => {
  const a = splitDiff(newFileDiff("src/same.mjs", 300), { ceilingBytes: CEILING, lineSplit: true });
  const b = splitDiff(newFileDiff("src/same.mjs", 310, { width: 58 }), { ceilingBytes: CEILING, lineSplit: true });
  const back = reassemble([...a.pieces, ...b.pieces], []);
  const texts = hunkTexts(back.files, "src/same.mjs");
  assert.equal(texts.length, 2, "two original hunks, not one merged body");
  assert.ok(texts.some((t) => t.startsWith("@@ -0,0 +1,300 @@")) && texts.some((t) => t.startsWith("@@ -0,0 +1,310 @@")));
  assert.deepEqual(back.incomplete, []);
});
test("reassemble: a missing or duplicated part is reported and never presented as the original hunk", () => {
  const src = newFileDiff("src/gap.mjs", 500);
  const r = splitDiff(src, { ceilingBytes: CEILING, lineSplit: true });
  assert.ok(r.pieces.length >= 4);
  const whole = reassemble(r.pieces, r.oversize);
  assert.deepEqual(whole.incomplete, [], "control: a complete set reports nothing");
  const missing = reassemble(r.pieces.filter((p) => p.lineSplit.part !== 2), r.oversize);
  assert.deepEqual(missing.incomplete.map((x) => ({ path: x.path, missing: x.missing, duplicated: x.duplicated })), [{ path: "src/gap.mjs", missing: [2], duplicated: [] }]);
  assert.ok(!hunkTexts(missing.files, "src/gap.mjs").some((t) => t.startsWith("@@ -0,0 +1,500 @@")), "the original header is not claimed for an incomplete body");
  assert.equal(hunkTexts(missing.files, "src/gap.mjs").length, r.pieces.length - 1, "the fragments that did arrive stay as the valid sub-hunks they are");
  const doubled = reassemble([...r.pieces, r.pieces[0]], r.oversize);
  assert.deepEqual(doubled.incomplete.map((x) => ({ missing: x.missing, duplicated: x.duplicated })), [{ missing: [], duplicated: [1] }]);
  assert.ok(!hunkTexts(doubled.files, "src/gap.mjs").some((t) => t.startsWith("@@ -0,0 +1,500 @@")));
});

// Seen live (rev_20260918174726_lc1e): greedy filling left a 1.5 KB tail after an 8 KB part,
// a poor review unit that still costs a full dispatch per route. Parts are balanced instead.
test("lineSplit: parts are balanced; no sliver tail", () => {
  for (const lines of [75, 140, 333, 900]) {
    const r = splitDiff(newFileDiff("src/even.mjs", lines), { ceilingBytes: CEILING, lineSplit: true });
    if (!r.pieces.length) continue;
    const sizes = r.pieces.map((p) => p.bytes), max = Math.max(...sizes), min = Math.min(...sizes);
    assert.ok(max <= CEILING, `${lines} lines: ${max} bytes`);
    assert.ok(min >= max * 0.6, `${lines} lines: smallest part ${min} bytes beside ${max}`);
    const greedy = Math.ceil(r.pieces.reduce((n, p) => n + rangesOf(p).body.length, 0) / (CEILING - 300));
    assert.ok(r.pieces.length <= greedy + 1, `${lines} lines: ${r.pieces.length} parts where about ${greedy} suffice`);
  }
});

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
