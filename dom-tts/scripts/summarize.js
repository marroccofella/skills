const MODES = new Set([
  "full",
  "informative",
  "summary",
  "action-items",
  "errors-only",
  "warnings-only",
  "terminal-summary",
  "diff-summary",
]);

function removeCodeBlocks(text, options = {}) {
  if (options.includeCodeBlocks === true || options.includeCodeBlocks === "true") return String(text || "");
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "\n[code block skipped]\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n[code block skipped]\n");
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, ""))
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\r\n/g, "\n");
}

function informativeText(text, options = {}) {
  const withoutCode = removeCodeBlocks(text, options);
  const cleaned = stripMarkdown(withoutCode)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^(powershell|bash|cmd|json|yaml|javascript|typescript|python)$/i.test(line))
    .filter(line => !/^[-+]{3,}|^diff --git\b|^@@\b/.test(line))
    .filter(line => {
      if (options.includeCommandBlocks === true || options.includeCommandBlocks === "true") return true;
      return !/^(node|npm|python|powershell|cd|git)\s+/i.test(line);
    })
    .map(line => {
      if (/^\[code block skipped\]$/i.test(line)) return "I skipped a code block.";
      return line
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^#{1,6}\s*/, "");
    })
    .join("\n");

  const paragraphs = cleaned
    .split(/\n{1,}/)
    .map(part => part.trim())
    .filter(Boolean);

  const compressed = [];
  let skippedCode = false;
  for (const paragraph of paragraphs) {
    if (paragraph === "I skipped a code block.") {
      skippedCode = true;
      continue;
    }
    compressed.push(paragraph);
  }
  if (skippedCode) compressed.push("I skipped extensive code and command blocks.");
  return codeAwareText(compressed.join("\n\n"));
}

function codeAwareText(text) {
  return stripMarkdown(text)
    .replace(/^\s*\d+\s*[|:]\s*/gm, "")
    .replace(/\b([a-z]+)_([a-z0-9_]+)\b/gi, value => value.replace(/_/g, " "))
    .replace(/\b([a-z][a-z0-9]*)([A-Z][a-z0-9]+)+\b/g, value => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .replace(/===/g, " triple equals ")
    .replace(/!==/g, " not double equals ")
    .replace(/==/g, " double equals ")
    .replace(/!=/g, " not equals ")
    .replace(/=>/g, " arrow ")
    .replace(/->/g, " arrow ")
    .replace(/\+\+/g, " increment ")
    .replace(/--/g, " decrement ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lines(text) {
  return stripMarkdown(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function firstSentences(text, limit = 3) {
  const clean = codeAwareText(text);
  const sentences = clean.match(/[^.!?\n]+[.!?]?/g) || [clean];
  return sentences.slice(0, limit).join(" ").trim();
}

function actionItems(text) {
  const hits = lines(text).filter(line =>
    /(^[-*]\s*\[[ x]\])|(\b(todo|next|action|follow up|fix|implement|verify|ship|decide|needs?|must|should)\b)/i.test(line)
  );
  return hits.length ? hits.join("\n") : firstSentences(text, 2);
}

function errorsOnly(text) {
  const hits = lines(text).filter(line =>
    /\b(error|failed|failure|exception|fatal|traceback|cannot|denied|not found|exit code [1-9])\b/i.test(line)
  );
  return hits.length ? hits.join("\n") : "No clear errors found.";
}

function warningsOnly(text) {
  const hits = lines(text).filter(line =>
    /\b(warn|warning|deprecated|caution|risk|skipped|unstable)\b/i.test(line)
  );
  return hits.length ? hits.join("\n") : "No clear warnings found.";
}

function terminalSummary(text) {
  const errorText = errorsOnly(text);
  if (errorText !== "No clear errors found.") return `Terminal reported errors. ${firstSentences(errorText, 4)}`;
  const warningText = warningsOnly(text);
  if (warningText !== "No clear warnings found.") return `Terminal completed with warnings. ${firstSentences(warningText, 3)}`;
  const cleanLines = lines(text);
  const tail = cleanLines.slice(-5).join(" ");
  return firstSentences(tail || text, 3) || "Terminal output is empty.";
}

function diffSummary(text) {
  const diffLines = lines(text);
  const added = diffLines.filter(line => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = diffLines.filter(line => line.startsWith("-") && !line.startsWith("---")).length;
  const files = diffLines
    .map(line => {
      const match = line.match(/^(?:diff --git a\/|[AMDR]\s+|[-+]{3}\s+(?:a\/|b\/)?)(\S+)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  const uniqueFiles = [...new Set(files)].slice(0, 6);
  if (uniqueFiles.length || added || removed) {
    return `Diff summary. ${uniqueFiles.length ? `Files touched: ${uniqueFiles.join(", ")}. ` : ""}${added} added lines and ${removed} removed lines.`;
  }
  return firstSentences(text, 3);
}

function applyMode(text, mode = "full", profile = "conversational", options = {}) {
  const selectedMode = MODES.has(mode) ? mode : "full";
  if (selectedMode === "informative") return informativeText(text, options);
  if (selectedMode === "summary") return firstSentences(text, profile === "concise" ? 2 : 3);
  if (selectedMode === "action-items") return codeAwareText(actionItems(text));
  if (selectedMode === "errors-only") return codeAwareText(errorsOnly(text));
  if (selectedMode === "warnings-only") return codeAwareText(warningsOnly(text));
  if (selectedMode === "terminal-summary") return codeAwareText(terminalSummary(text));
  if (selectedMode === "diff-summary") return codeAwareText(diffSummary(text));
  return codeAwareText(text);
}

function cli() {
  const args = process.argv.slice(2);
  const textIndex = args.indexOf("--text");
  const modeIndex = args.indexOf("--mode");
  const profileIndex = args.indexOf("--profile");
  const text = textIndex >= 0 ? args[textIndex + 1] : "";
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : "summary";
  const profile = profileIndex >= 0 ? args[profileIndex + 1] : "conversational";
  process.stdout.write(applyMode(text, mode, profile));
}

if (require.main === module) cli();

module.exports = {
  applyMode,
  codeAwareText,
  informativeText,
  stripMarkdown,
};
