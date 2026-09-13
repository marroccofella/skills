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
  test(`${label}: same-directory affinity; whole files never split`, () => {
    for (const p of pieces) {
      if (p.files.length === 1) continue;
      for (const path of p.files) assert.equal(parseUnifiedDiff(p.text).find((f) => f.path === path).hunks.length, files.find((f) => f.path === path).hunks.length);
    }
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
  assert.equal(headerOnlyQuote("  +++ b/src/a.js\r\n  --- a/src/a.js\r\n"), true);
  assert.equal(headerOnlyQuote("new file mode 100644\nrename from a\nrename to b"), true);
});
test("headerOnlyQuote: false for code or mixed text", () => {
  assert.equal(headerOnlyQuote("+const x = 1;"), false);
  assert.equal(headerOnlyQuote("diff --git a/x b/x\n+const x = 1;"), false);
  assert.equal(headerOnlyQuote("--- a/x\n missing semicolon here"), false);
  assert.equal(headerOnlyQuote(""), false);
  assert.equal(headerOnlyQuote(null), false);
  assert.equal(headerOnlyQuote("---"), false);
});

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
