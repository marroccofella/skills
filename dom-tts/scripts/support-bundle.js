const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { collectDiagnostics } = require("./support-safety");

function buildArchive(root, options = {}) {
  const platform = options.platform || process.platform;
  const base = options.base || process.env.LOCALAPPDATA;
  const run = options.run || spawnSync;
  if (platform !== "win32") throw new Error("Support archives require Windows; the diagnostic self-test runs offline on all platforms.");
  if (!base || !path.isAbsolute(base)) throw new Error("A valid local application data directory is required.");
  const parent = path.join(base, "42uk", "DomTTS", "support-bundles");
  fs.mkdirSync(parent, { recursive: true });
  const bundle = fs.mkdtempSync(path.join(parent, "dom-tts-support-"));
  const file = path.join(bundle, "diagnostics.json");
  const zip = path.join(bundle, "support.zip");
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const protection = [
    "$ErrorActionPreference='Stop'",
    "$env:PSModulePath=Join-Path $PSHOME 'Modules'",
    "$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$acl=New-Object System.Security.AccessControl.DirectorySecurity",
    "$acl.SetOwner($owner)",
    "$acl.SetAccessRuleProtection($true,$false)",
    "foreach($sid in @($owner.Value,'S-1-5-18','S-1-5-32-544')) {",
    "$identity=New-Object System.Security.Principal.SecurityIdentifier($sid)",
    "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
    "$acl.AddAccessRule($rule)",
    "}",
    `Set-Acl -LiteralPath ${quote(bundle)} -AclObject $acl`,
  ].join("; ");
  const protectedResult = run(powershell, ["-NoProfile", "-Command", protection], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (protectedResult.error || protectedResult.status !== 0) {
    fs.rmdirSync(bundle);
    throw new Error("Could not protect diagnostic directory; no diagnostic data was written.");
  }
  fs.writeFileSync(file, JSON.stringify(collectDiagnostics(root), null, 2), { mode: 0o600 });
  const result = run(powershell, ["-NoProfile", "-Command",
    `$ErrorActionPreference='Stop'; $env:PSModulePath=Join-Path $PSHOME 'Modules'; Compress-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(zip)}`,
  ], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error("Could not create diagnostic archive; sanitized JSON remains in the protected local directory.");
  fs.unlinkSync(file);
  return zip;
}

function main() {
  const zip = buildArchive(path.resolve(__dirname, ".."));
  console.log("Dom TTS diagnostic archive created. Review before sharing.");
  console.log(zip);
}

module.exports = { buildArchive };

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
