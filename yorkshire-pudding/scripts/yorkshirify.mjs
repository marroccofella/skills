#!/usr/bin/env node
// yorkshirify.mjs — deterministic Yorkshire-dialect pass for plain prose.
//
// Zero dependencies, Node 18+. Spawns no subprocesses, makes no network
// calls, reads nothing but the text you give it. Code-aware translation
// (comments, docstrings, log strings) is the driving agent's job — see
// ../references/code-translation.md. This script is the quick taste:
// pipe plain prose or markdown through it and get dialect back.
//
// Usage:
//   echo "The cat sat on the mat" | node yorkshirify.mjs
//   node yorkshirify.mjs --input README.md --level broad
//   node yorkshirify.mjs --self-test
//
// Levels (cumulative — each includes everything below it):
//   mild    a splash o' gravy: greetings and lexicon words only
//   proper  (default) t'reduction, were-levelling, -in', o'/wi', lexicon
//   broad   swimmin' in gravy: thee/tha, h-dropping, allus/baht/'appen

import { readFileSync } from "node:fs";
import process from "node:process";

const VERSION = "1.0.0";
const LEVELS = ["mild", "proper", "broad"];

// ---------------------------------------------------------------------------
// Lexicon. Cumulative by level. Sources are matched case-insensitively on
// word boundaries; longest source wins first, so "you're" beats "you" and
// "nothing but" beats "nothing". Outputs never re-match a source.
// ---------------------------------------------------------------------------

const LEXICON = {
  mild: [
    ["thank you very much", "ta very much"],
    ["thank you", "ta"],
    ["stop it", "gi'o'er"],
    ["oh no", "by 'eck"],
    ["hello", "ey up"],
    ["hi", "ey up"],
    ["goodbye", "sithee"],
    ["bye", "ta'ra"],
    ["thanks", "ta"],
    ["yes", "aye"],
    ["very", "proper"],
    ["really", "right"],
    ["excellent", "champion"],
    ["amazing", "beltin'"],
    ["awesome", "beltin'"],
    ["wonderful", "grand"],
    ["pleased", "chuffed"],
    ["delighted", "chuffed to bits"],
    ["silly", "daft"],
    ["idiot", "wazzock"],
    ["fool", "wazzock"],
    ["confused", "flummoxed"],
    ["moody", "mardy"],
    ["sulky", "mardy"],
    ["wow", "ee by gum"],
    ["damn", "flippin' 'eck"],
    ["alley", "ginnel"],
  ],
  proper: [
    ["isn't it", "in't it"],
    ["nothing", "nowt"],
    ["anything", "owt"],
    ["something", "summat"],
    ["anyway", "any road"],
    ["isn't", "in't"],
    ["my", "me"],
  ],
  broad: [
    ["shut the door", "put wood in t'hole"],
    ["nothing but", "nobbut"],
    ["you are", "tha'rt"],
    ["you're", "tha'rt"],
    ["yourself", "thisen"],
    ["myself", "misen"],
    ["himself", "hissen"],
    ["herself", "'ersen"],
    ["children", "bairns"],
    ["perhaps", "'appen"],
    ["without", "baht"],
    ["always", "allus"],
    ["maybe", "'appen"],
    ["child", "bairn"],
    ["yours", "thine"],
    ["your", "thi"],
    ["you", "tha"],
    ["old", "owd"],
  ],
};

// Broad-mode h-dropping is restricted to a safe word list so "hotel" and
// "history" survive. "havin" (no apostrophe) catches the output of the
// -ing rule, which runs first.
const H_WORDS = [
  "have", "haven't", "having", "havin", "had", "has", "happen", "happened",
  "happens", "home", "house", "houses", "here", "head", "heads", "hand",
  "hands", "half", "hundred", "hold", "horse", "horses", "hear", "heard",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Preserve the shape of the source word: ALL CAPS stays all caps, a leading
// capital re-capitalises the first *letter* of the output (so "Perhaps"
// becomes "'Appen", not "'appen").
function cased(source, output) {
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) {
    return output.toUpperCase();
  }
  if (/^[A-Z]/.test(source)) {
    const i = output.search(/[a-z]/i);
    if (i === -1) return output;
    return output.slice(0, i) + output[i].toUpperCase() + output.slice(i + 1);
  }
  return output;
}

// Stash anything that must never be translated: fenced code, inline code,
// URLs, emails, template placeholders, printf specifiers.
const PROTECT_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  /\bhttps?:\/\/[^\s)]+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /\$\{[^}]*\}/g,
  /%[sdifj%]/g,
];

function protect(text) {
  const stash = [];
  let out = text;
  for (const pattern of PROTECT_PATTERNS) {
    out = out.replace(pattern, (m) => {
      stash.push(m);
      return `\x00${stash.length - 1}\x00`;
    });
  }
  return { out, stash };
}

const restore = (text, stash) =>
  text.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)]);

// ---------------------------------------------------------------------------
// The transform
// ---------------------------------------------------------------------------

export function yorkshirify(text, level = "proper") {
  if (!LEVELS.includes(level)) {
    throw new Error(`unknown level "${level}" — expected one of: ${LEVELS.join(", ")}`);
  }
  // NUL bytes are garbage in prose and would collide with the protect()
  // sentinels, so they are dropped up front.
  const { out: protectedText, stash } = protect(text.replace(/\x00/g, ""));
  let out = protectedText;

  // 1. Lexicon for every active level, longest source first.
  const active = LEVELS.slice(0, LEVELS.indexOf(level) + 1)
    .flatMap((l) => LEXICON[l])
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of active) {
    const re = new RegExp(`\\b${escapeRegex(from)}\\b`, "gi");
    out = out.replace(re, (m) => cased(m, to));
  }

  if (level !== "mild") {
    // 2. Were-levelling: "I was" -> "I were".
    out = out.replace(/\bwasn't\b/gi, (m) => cased(m, "weren't"));
    out = out.replace(/\bwas\b/gi, (m) => cased(m, "were"));

    // 3. Definite article reduction, plus o' and wi'. [ \t] only, never \s:
    //    reducing across a newline would rejoin the author's line breaks.
    out = out.replace(/\b([Tt])he\b[ \t]+(?=[A-Za-z0-9\x00])/g, (_, t) => `${t}'`);
    out = out.replace(/\b([Oo])f\b/g, (_, o) => `${o}'`);
    out = out.replace(/\b([Ww])ith\b/g, (_, w) => `${w}i'`);

    // 4. G-dropping: only when the stem keeps a vowel, so "thing", "king"
    //    and "bring" survive while "doing" becomes "doin'".
    out = out.replace(/\b([A-Za-z]+)ing\b/g, (m, stem) => {
      if (!/[aeiouy]/i.test(stem)) return m;
      return m === m.toUpperCase() ? `${stem}IN'` : `${stem}in'`;
    });
  }

  if (level === "broad") {
    // 5. H-dropping from the safe list.
    for (const word of H_WORDS) {
      const rest = word.slice(1);
      const re = new RegExp(`\\b[Hh]${escapeRegex(rest)}\\b`, "g");
      out = out.replace(re, (m) => `'${cased(m, rest)}`);
    }
  }

  return restore(out, stash);
}

// ---------------------------------------------------------------------------
// Self-test: deterministic, zero model calls, zero subprocesses.
// ---------------------------------------------------------------------------

const SELF_TESTS = [
  {
    name: "mild touches lexicon only",
    level: "mild",
    input: "Hello! That was very excellent, thank you.",
    expect: "Ey up! That was proper champion, ta.",
  },
  {
    name: "definite article reduction",
    level: "proper",
    input: "The cat sat on the mat.",
    expect: "T'cat sat on t'mat.",
  },
  {
    name: "owt, nowt, were-levelling, g-dropping",
    level: "proper",
    input: "Nothing was doing anything, something else.",
    expect: "Nowt were doin' owt, summat else.",
  },
  {
    name: "thing and king keep their g",
    level: "proper",
    input: "The thing is doing something with my old friend.",
    expect: "T'thing is doin' summat wi' me old friend.",
  },
  {
    name: "wasn't, of, and the end of the day",
    level: "proper",
    input: "It wasn't the end of the day.",
    expect: "It weren't t'end o' t'day.",
  },
  {
    name: "broad thee/tha and h-dropping",
    level: "broad",
    input: "Have you seen your house? Perhaps you are cold.",
    expect: "'Ave tha seen thi 'ouse? 'Appen tha'rt cold.",
  },
  {
    name: "inline code and URLs are never translated",
    level: "proper",
    input: "Run `the doing code` at https://the-thing.example.com and read the docs.",
    expect: "Run `the doing code` at https://the-thing.example.com and read t'docs.",
  },
  {
    name: "fenced code blocks are never translated",
    level: "proper",
    input: "the top\n```js\nconst the = doing;\n```\nthe bottom",
    expect: "t'top\n```js\nconst the = doing;\n```\nt'bottom",
  },
  {
    name: "put wood in t'hole",
    level: "broad",
    input: "Shut the door, it's nothing but trouble.",
    expect: "Put wood in t'hole, it's nobbut trouble.",
  },
  {
    name: "template placeholders survive",
    level: "proper",
    input: "Something is coming for ${user} with %s of the goods.",
    expect: "Summat is comin' for ${user} wi' %s o' t'goods.",
  },
  {
    name: "all-caps words keep their shape",
    level: "proper",
    input: "IT WAS NOTHING.",
    expect: "IT WERE NOWT.",
  },
  {
    name: "haven't h-drops with its apostrophe intact",
    level: "broad",
    input: "I haven't seen it. Haven't you?",
    expect: "I 'aven't seen it. 'Aven't tha?",
  },
];

function runSelfTest() {
  let failed = 0;
  for (const t of SELF_TESTS) {
    let actual;
    try {
      actual = yorkshirify(t.input, t.level);
    } catch (err) {
      actual = `<threw: ${err.message}>`;
    }
    if (actual === t.expect) {
      console.log(`  ok   ${t.name}`);
    } else {
      failed += 1;
      console.error(`  FAIL ${t.name}`);
      console.error(`       input:    ${JSON.stringify(t.input)}`);
      console.error(`       expected: ${JSON.stringify(t.expect)}`);
      console.error(`       actual:   ${JSON.stringify(actual)}`);
    }
  }
  // Unknown levels must fail closed, never silently pass text through.
  try {
    yorkshirify("text", "gravy-boat");
    failed += 1;
    console.error("  FAIL unknown level should throw");
  } catch {
    console.log("  ok   unknown level fails closed");
  }
  const total = SELF_TESTS.length + 1;
  if (failed > 0) {
    console.error(`\n${failed}/${total} self-tests failed`);
    process.exit(1);
  }
  console.log(`\nall ${total} self-tests passed — champion`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `yorkshirify ${VERSION} — turn plain prose into Yorkshire dialect

usage:
  echo "text" | node yorkshirify.mjs [--level mild|proper|broad]
  node yorkshirify.mjs --input <file> [--level <level>]
  node yorkshirify.mjs --self-test
  node yorkshirify.mjs --list [--level <level>]

options:
  --level <l>   gravy level: mild, proper (default), or broad
  --input <f>   read from a file instead of stdin
  --list        print the active lexicon as JSON and exit
  --self-test   run the deterministic test suite (used by CI)
  --version     print the version and exit
  --help        show this text

This tool is for plain prose and markdown. Do not pipe source code
through it — code-aware translation rules live in
references/code-translation.md and are applied by the driving agent.`;

function main() {
  const argv = process.argv.slice(2);
  const opts = { level: "proper", input: null, selfTest: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`missing value for ${arg}\n\n${HELP}`);
        process.exit(2);
      }
      return value;
    };
    if (arg === "--level") opts.level = next();
    else if (arg === "--input") opts.input = next();
    else if (arg === "--self-test") opts.selfTest = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--version") { console.log(VERSION); return; }
    else if (arg === "--help" || arg === "-h") { console.log(HELP); return; }
    else { console.error(`unknown option: ${arg}\n\n${HELP}`); process.exit(2); }
  }

  if (opts.selfTest) { runSelfTest(); return; }

  if (!LEVELS.includes(opts.level)) {
    console.error(`unknown level "${opts.level}" — expected one of: ${LEVELS.join(", ")}`);
    process.exit(2);
  }

  if (opts.list) {
    const active = LEVELS.slice(0, LEVELS.indexOf(opts.level) + 1)
      .flatMap((l) => LEXICON[l].map(([from, to]) => ({ from, to, level: l })));
    console.log(JSON.stringify(active, null, 2));
    return;
  }

  let text;
  if (opts.input) {
    text = readFileSync(opts.input, "utf8");
  } else if (!process.stdin.isTTY) {
    text = readFileSync(0, "utf8");
  } else {
    console.error(HELP);
    process.exit(2);
  }

  process.stdout.write(yorkshirify(text, opts.level));
}

main();
