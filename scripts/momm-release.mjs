#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git, treeHash } from "../momm/scripts/update.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 1 || !["--prepare", "--check"].includes(args[0])) throw new Error("Usage: node scripts/momm-release.mjs --prepare|--check");
const file = path.join(root, "versions.json"), manifest = JSON.parse(fs.readFileSync(file));
const version = manifest.momm, release = manifest.momm_releases?.find(r => r.version === version);
if (!/^\d+\.\d+\.\d+$/.test(version) || release?.tag !== `momm-${version}`) throw new Error("Release version/tag mismatch");
const code = fs.readFileSync(path.join(root, "momm/scripts/multi-review.mjs"), "utf8");
if (!code.includes(`const MOMM_VERSION = "${version}"`)) throw new Error("Dispatcher and manifest versions differ");
if (!fs.readFileSync(path.join(root, "README.md"), "utf8").includes(`momm-${version}-`)) throw new Error("README version differs");
const ref = args[0] === "--prepare" ? git(root, "write-tree") : "HEAD";
const digest = treeHash(root, ref);
if (args[0] === "--prepare") {
  release.sha256 = digest;
  release.hash_covers = "git-tree-blobs-excluding-versions/1";
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(`Prepared ${release.tag}: ${digest}. Stage versions.json and commit, then run --check.\n`);
} else {
  if (release.sha256 !== digest || release.hash_covers !== "git-tree-blobs-excluding-versions/1") throw new Error("Release package hash does not match committed tree");
  const committed = JSON.parse(git(root, "show", "HEAD:versions.json"));
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) throw new Error("Working manifest differs from committed manifest");
  process.stdout.write(`Release seal verified: ${release.tag} ${digest}\n`);
}
