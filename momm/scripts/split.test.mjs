// Tests for split.mjs (MOMM 1.16.0 E5). Run: node momm/scripts/split.test.mjs
import assert from "node:assert/strict";
import { parseUnifiedDiff, splitDiff, reassemble, headerOnlyQuote } from "./split.mjs";

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

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
