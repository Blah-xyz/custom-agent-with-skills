import { existsSync, lstatSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let apply = false;
let targetHome = homedir();
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--apply") apply = true;
  else if (arg === "--home" && args[index + 1]) targetHome = resolve(args[++index]);
  else throw new Error("Usage: bun install.ts [--apply] [--home /absolute/home]");
}
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const codexHome = args.includes("--home")
  ? join(targetHome, ".codex")
  : resolve(process.env.CODEX_HOME || join(targetHome, ".codex"));
if (!isAbsolute(codexHome)) throw new Error("Codex home must be absolute.");
const skillRoot = join(targetHome, ".agents", "skills", "crew");

type InstallEntry = { source: string; target: string };
const entries: InstallEntry[] = [
  { source: "global-instructions.md", target: join(codexHome, "AGENTS.md") },
  { source: "crew.skill.md", target: join(skillRoot, "SKILL.md") },
  { source: "crew.metadata.yaml.example", target: join(skillRoot, "agents", "openai.yaml") },
  ...["explorer", "worker", "reviewer"].map((name) => ({
    source: join("agents", name + ".toml.example"),
    target: join(codexHome, "agents", name + ".toml"),
  })),
];

// Validate all inputs and destinations before any writes.
for (const entry of entries) {
  readFileSync(join(sourceRoot, entry.source), "utf8");
  for (let current = entry.target; ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("Refusing to overwrite through a symlink: " + current);
    if (dirname(current) === current) break;
  }
  if (existsSync(entry.target) && !lstatSync(entry.target).isFile())
    throw new Error("Destination is not a regular file: " + entry.target);
}
const override = join(codexHome, "AGENTS.override.md");
if (existsSync(override) && readFileSync(override, "utf8").trim())
  throw new Error("A nonempty AGENTS.override.md would shadow these preferences. Resolve that override before installing: " + override);

const pending = entries.filter((entry) => !existsSync(entry.target)
  || readFileSync(entry.target, "utf8") !== readFileSync(join(sourceRoot, entry.source), "utf8"));
for (const entry of entries)
  console.log((pending.includes(entry) ? (existsSync(entry.target) ? "UPDATE " : "CREATE ") : "UNCHANGED ") + entry.target);
if (!apply) {
  console.log("\nPreview only. Run again with --apply to install.");
} else if (pending.length === 0) {
  console.log("\nAlready installed; no changes.");
} else {
  const backupRoot = join(codexHome, "backups", "crew-" + Date.now());
  // Back up every changed existing file before modifying any destination.
  for (const [index, entry] of pending.entries()) {
    if (existsSync(entry.target)) {
      mkdirSync(backupRoot, { recursive: true });
      copyFileSync(entry.target, join(backupRoot, index + "-" + entry.source.replaceAll("/", "_")));
    }
  }
  for (const entry of pending) {
    mkdirSync(dirname(entry.target), { recursive: true });
    writeFileSync(entry.target, readFileSync(join(sourceRoot, entry.source)), { mode: 0o600 });
  }
  console.log("\nInstalled " + pending.length + " files. Existing changed files were backed up if present.");
  console.log("Backup location (if created): " + backupRoot);
  console.log("Open a new Codex conversation to verify the global instructions, Crew, and custom agents are discovered.");
}
