import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE = `Usage: bun reference/codex-crew/install.ts [--apply | --dry-run] [--home /absolute/home]

The default is a read-only preview. --dry-run explicitly selects that behavior.
--home selects both a Codex home and a skill home and ignores CODEX_HOME.
Otherwise CODEX_HOME selects the Codex home; the skill stays in ~/.agents/skills/crew.
CODEX_HOME must be absolute if set. Empty or unset values default to ~/.codex.
Existing changed files are replaced in full and backed up before installation.
--help shows this message without inspecting or writing destinations.`;

export type Options = { apply: boolean; help: boolean; home: string | undefined };
export type InstallPaths = { codexHome: string; skillRoot: string };
type Snapshot = { data: Buffer; mode: number; dev: number; ino: number };
type InstallEntry = {
  source: string;
  target: string;
  data: Buffer;
  original: Snapshot | undefined;
  action: "CREATE" | "UPDATE" | "UNCHANGED";
};
export type InstallPlan = { paths: InstallPaths; entries: readonly InstallEntry[] };
type RenameFile = (source: string, destination: string) => void;
type StagedEntry = { entry: InstallEntry; directory: string; payload: string; stat: Stats };

function absolutePath(value: string, label: string): string {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${label} must be an absolute path (expand ~ in your shell): ${value}`);
  }
  return resolve(value);
}

export function parseArguments(args: readonly string[]): Options {
  let apply = false;
  let dryRun = false;
  let help = false;
  let home: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) break;
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}\n${USAGE}`);
    seen.add(arg);
    switch (arg) {
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
        help = true;
        break;
      case "--home": {
        const value = args[++index];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`--home requires an absolute path.\n${USAGE}`);
        }
        home = absolutePath(value, "--home");
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    }
  }
  if (apply && dryRun) throw new Error("--apply and --dry-run cannot be combined.");
  if (help && args.length !== 1) throw new Error("Use --help by itself.");
  return { apply, help, home };
}

export function resolvePaths(
  options: Options,
  environment: { userHome: string; codexHome: string | undefined } = {
    userHome: homedir(),
    codexHome: process.env.CODEX_HOME,
  },
): InstallPaths {
  const home = absolutePath(options.home ?? environment.userHome, "User home");
  return {
    codexHome:
      options.home !== undefined
        ? join(home, ".codex")
        : absolutePath(environment.codexHome || join(home, ".codex"), "CODEX_HOME"),
    skillRoot: join(home, ".agents", "skills", "crew"),
  };
}

function statIfPresent(path: string): Stats | undefined {
  try {
    // lstat sees dangling links too; existsSync would miss them.
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function validatePath(path: string, leaf: "file" | "directory"): void {
  absolutePath(path, "Destination");
  for (let current = path; ; current = dirname(current)) {
    const stat = statIfPresent(current);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing a symlinked destination: ${current}`);
    if (stat && !(current === path && leaf === "file" ? stat.isFile() : stat.isDirectory())) {
      throw new Error(
        `Destination is not a regular ${current === path ? leaf : "directory"}: ${current}`,
      );
    }
    if (dirname(current) === current) break;
  }
}

function checkWritableParent(path: string): void {
  let current = dirname(path);
  while (!statIfPresent(current)) current = dirname(current);
  accessSync(current, constants.W_OK | constants.X_OK);
}

function snapshot(path: string): Snapshot | undefined {
  const stat = statIfPresent(path);
  if (!stat) return undefined;
  return { data: readFileSync(path), mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino };
}

function checkOverride(paths: InstallPaths): void {
  const path = join(paths.codexHome, "AGENTS.override.md");
  validatePath(path, "file");
  if (statIfPresent(path) && readFileSync(path, "utf8").trim()) {
    throw new Error(`Nonempty AGENTS.override.md would shadow this installation: ${path}`);
  }
}

export function createPlan(
  paths: InstallPaths,
  sourceRoot = dirname(fileURLToPath(import.meta.url)),
): InstallPlan {
  const templates = [
    { source: "global-instructions.md", target: join(paths.codexHome, "AGENTS.md") },
    { source: "crew.skill.md", target: join(paths.skillRoot, "SKILL.md") },
    {
      source: "crew.metadata.yaml.example",
      target: join(paths.skillRoot, "agents", "openai.yaml"),
    },
    ...["explorer", "worker", "reviewer"].map((name) => ({
      source: `agents/${name}.toml.example`,
      target: join(paths.codexHome, "agents", `${name}.toml`),
    })),
  ];
  // Load all source bytes before doing anything to destinations.
  const inputs = templates.map((entry) => ({
    ...entry,
    data: readFileSync(join(sourceRoot, entry.source)),
  }));
  const entries: InstallEntry[] = inputs.map((entry) => {
    validatePath(entry.target, "file");
    const original = snapshot(entry.target);
    const action = original
      ? original.data.equals(entry.data)
        ? "UNCHANGED"
        : "UPDATE"
      : "CREATE";
    if (action !== "UNCHANGED") checkWritableParent(entry.target);
    return { ...entry, original, action };
  });
  checkOverride(paths);
  if (entries.some((entry) => entry.action !== "UNCHANGED")) {
    const backups = join(paths.codexHome, "backups");
    validatePath(backups, "directory");
    checkWritableParent(join(backups, "pending"));
  }
  return { paths, entries };
}

function assertUnchanged(entry: InstallEntry): void {
  validatePath(entry.target, "file");
  const current = snapshot(entry.target);
  const previous = entry.original;
  if (
    previous
      ? !current ||
        current.dev !== previous.dev ||
        current.ino !== previous.ino ||
        current.mode !== previous.mode ||
        !current.data.equals(previous.data)
      : current !== undefined
  ) {
    throw new Error(`Destination changed since preview; refusing to overwrite: ${entry.target}`);
  }
}

function ensureDirectory(path: string, created: string[]): void {
  validatePath(path, "directory");
  if (statIfPresent(path)) return;
  ensureDirectory(dirname(path), created);
  mkdirSync(path, { mode: 0o700 });
  created.push(path);
  chmodSync(path, 0o700);
}

function writeExclusive(path: string, data: Buffer | string, mode: number): void {
  writeFileSync(path, data, { flag: "wx", mode });
  // Explicitly restore permission bits rather than letting umask narrow them.
  chmodSync(path, mode);
}

function stage(entry: InstallEntry, directories: string[]): StagedEntry {
  const directory = mkdtempSync(join(dirname(entry.target), ".crew-stage-"));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const payload = join(directory, "payload");
  writeExclusive(payload, entry.data, entry.original?.mode ?? 0o600);
  return { entry, directory, payload, stat: lstatSync(payload) };
}

function rollback(item: StagedEntry, renameFile: RenameFile): void {
  const { entry } = item;
  validatePath(entry.target, "file");
  const current = snapshot(entry.target);
  // Never erase a change made by somebody else while installation was in progress.
  if (
    !current ||
    current.ino !== item.stat.ino ||
    current.dev !== item.stat.dev ||
    current.mode !== (item.stat.mode & 0o777) ||
    !current.data.equals(entry.data)
  ) {
    throw new Error(`Cannot roll back a concurrently changed destination: ${entry.target}`);
  }
  if (entry.original) {
    const restore = join(item.directory, "original");
    writeExclusive(restore, entry.original.data, entry.original.mode);
    renameFile(restore, entry.target);
  } else {
    unlinkSync(entry.target);
  }
}

export function applyPlan(
  plan: InstallPlan,
  renameFile: RenameFile = renameSync,
): { count: number; backupRoot: string | undefined } {
  const pending = plan.entries.filter((entry) => entry.action !== "UNCHANGED");
  if (pending.length === 0) {
    for (const entry of plan.entries) assertUnchanged(entry);
    checkOverride(plan.paths);
    return { count: 0, backupRoot: undefined };
  }
  const created: string[] = [];
  const locks: string[] = [];
  const staging: string[] = [];
  const committed: StagedEntry[] = [];
  let backupRoot: string | undefined;
  let failure: Error | undefined;
  const cleanupFailures: string[] = [];
  function cleanup(operation: () => void, ignoreNonempty = false): void {
    try {
      operation();
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (code === "ENOENT" || (ignoreNonempty && (code === "ENOTEMPTY" || code === "EEXIST")))
        return;
      cleanupFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    for (const entry of pending) ensureDirectory(dirname(entry.target), created);
    // Both locks cover installs sharing either the Codex profile or the personal skill.
    for (const root of [...new Set([plan.paths.codexHome, plan.paths.skillRoot])].sort()) {
      const lock = join(root, ".crew-install.lock");
      validatePath(lock, "directory");
      if (statIfPresent(lock)) throw new Error(`Installation lock already exists: ${lock}`);
      mkdirSync(lock, { mode: 0o700 });
      locks.push(lock);
    }
    for (const entry of plan.entries) assertUnchanged(entry);
    checkOverride(plan.paths);
    const backups = join(plan.paths.codexHome, "backups");
    ensureDirectory(backups, created);
    backupRoot = mkdtempSync(join(backups, "crew-"));
    chmodSync(backupRoot, 0o700);
    const recoveryRoot = backupRoot;
    const manifest = pending.map((entry, index) => {
      const backup = entry.original ? `${index}-original` : null;
      if (entry.original && backup) {
        writeExclusive(join(recoveryRoot, backup), entry.original.data, 0o600);
      }
      return {
        target: entry.target,
        source: entry.source,
        backup,
        originalMode: entry.original?.mode ?? null,
      };
    });
    writeExclusive(
      join(backupRoot, "manifest.json"),
      `${JSON.stringify({ version: 1, entries: manifest }, null, 2)}\n`,
      0o600,
    );
    const staged = pending.map((entry) => stage(entry, staging));
    for (const entry of plan.entries) assertUnchanged(entry);
    checkOverride(plan.paths);
    for (const item of staged) {
      assertUnchanged(item.entry);
      checkOverride(plan.paths);
      renameFile(item.payload, item.entry.target);
      committed.push(item);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const item of committed.reverse()) {
      try {
        rollback(item, renameFile);
      } catch (failure) {
        failures.push(failure instanceof Error ? failure.message : String(failure));
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    const recovery = backupRoot ? ` Recovery directory: ${backupRoot}.` : "";
    failure = new Error(
      `${reason}. ${failures.length ? `Rollback incomplete: ${failures.join("; ")}.` : "Destination changes rolled back."}${recovery}`,
      { cause: error },
    );
  } finally {
    for (const directory of staging.reverse())
      cleanup(() => rmSync(directory, { recursive: true, force: true }));
    for (const lock of locks.reverse()) cleanup(() => rmdirSync(lock));
    for (const directory of created.reverse()) {
      // Leave nonempty directories, including recovery backups, intact.
      cleanup(() => rmdirSync(directory), true);
    }
  }
  if (cleanupFailures.length) {
    failure = new Error(
      `${failure?.message ?? "Installation completed."} Cleanup failed: ${cleanupFailures.join("; ")}`,
      { cause: failure },
    );
  }
  if (failure) throw failure;
  return { count: pending.length, backupRoot };
}
