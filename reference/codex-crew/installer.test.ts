import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./install";
import {
  applyPlan,
  createPlan,
  type InstallPaths,
  parseArguments,
  resolvePaths,
} from "./installer";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(sourceRoot, "install.ts");
let sandbox: string;
let home: string;
let paths: InstallPaths;

beforeEach(() => {
  // macOS /var and /tmp are symlinks. Use their canonical paths for isolated homes.
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "crew-test-")));
  home = join(sandbox, "home");
  mkdirSync(home);
  paths = resolvePaths(parseArguments(["--home", home]));
});
afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

function write(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(path: string): void {
    const stat = lstatSync(path);
    const relative = path.slice(root.length);
    if (stat.isDirectory()) {
      result[relative] = "directory";
      for (const name of readdirSync(path)) visit(join(path, name));
    } else {
      result[relative] = `${stat.mode}:${stat.mtimeMs}:${readFileSync(path).toString("base64")}`;
    }
  }
  visit(root);
  return result;
}

function runCli(args: readonly string[], environment: Record<string, string> = {}) {
  return Bun.spawnSync([process.execPath, cli, ...args], {
    cwd: sandbox,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: "",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(sandbox, "runtime-cache"),
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function expectNoTemporaryArtifacts(): void {
  const names = Object.keys(tree(home));
  expect(
    names.filter((name) => name.includes(".crew-stage-") || name.includes(".crew-install.lock")),
  ).toEqual([]);
}

describe("arguments and home selection", () => {
  test("preview is the default; dry-run is explicit; apply is opt-in", () => {
    expect(parseArguments([]).apply).toBe(false);
    expect(parseArguments(["--dry-run"]).apply).toBe(false);
    expect(parseArguments(["--apply"]).apply).toBe(true);
    expect(parseArguments(["--help"]).help).toBe(true);
  });
  const invalidArguments = [
    ["--home"],
    ["--home", "--apply"],
    ["--apply", "--home", "--apply"],
    ["--home", "relative"],
    ["--home", "~/.codex"],
    ["--home", "/a\0b"],
    ["--dry-run", "--apply"],
    ["--apply", "--dry-run"],
    ["--apply", "--apply"],
    ["--dry-run", "--dry-run"],
    ["--home", "/a", "--home", "/b"],
    ["--help", "--apply"],
    ["--unknown"],
  ];
  test.each(invalidArguments.map((args) => ({ args })))(
    "rejects unsafe or ambiguous arguments: %j",
    ({ args }) => {
      expect(() => parseArguments(args)).toThrow();
    },
  );
  test.each([undefined, ""])(
    "unset/empty CODEX_HOME falls back to the user home: %s",
    (codexHome) => {
      expect(resolvePaths(parseArguments([]), { userHome: home, codexHome })).toEqual(paths);
    },
  );
  test("absolute CODEX_HOME redirects only instructions and agents", () => {
    const profile = join(sandbox, "profile");
    expect(resolvePaths(parseArguments([]), { userHome: home, codexHome: profile })).toEqual({
      codexHome: profile,
      skillRoot: paths.skillRoot,
    });
  });
  test.each(["relative", "~/.codex", " ", "/a\0b"])(
    "rejects invalid CODEX_HOME: %s",
    (codexHome) => {
      expect(() => resolvePaths(parseArguments([]), { userHome: home, codexHome })).toThrow(
        "absolute",
      );
    },
  );
  test("--home ignores even invalid CODEX_HOME and an invalid fallback home", () => {
    expect(
      resolvePaths(parseArguments(["--home", home]), {
        userHome: "relative",
        codexHome: "relative",
      }),
    ).toEqual(paths);
  });
});

describe("read-only CLI and template validation", () => {
  test.each([{ args: [] }, { args: ["--dry-run"] }])(
    "preview makes no destination changes: %j",
    ({ args }) => {
      write(join(paths.codexHome, "AGENTS.md"), "Existing instructions\n");
      const before = tree(home);
      const result = runCli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("UPDATE");
      expect(result.stdout.toString()).toContain("nothing written");
      expect(tree(home)).toEqual(before);
    },
  );
  test("--home overrides both HOME and CODEX_HOME in the CLI", () => {
    const decoy = join(sandbox, "decoy");
    mkdirSync(decoy);
    const result = runCli(["--apply", "--home", home], {
      HOME: decoy,
      CODEX_HOME: "relative-decoy",
    });
    expect(result.exitCode).toBe(0);
    expect(readdirSync(decoy)).toEqual([]);
    expect(readFileSync(join(paths.skillRoot, "SKILL.md"), "utf8")).toContain("name: crew");
  });
  test("help does not inspect destinations, even with an invalid profile", () => {
    const before = tree(home);
    const result = runCli(["--help"], { CODEX_HOME: "relative" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage:");
    expect(tree(home)).toEqual(before);
    expect(typeof main).toBe("function");
  });
  test("CLI errors use a nonzero exit code and never write", () => {
    const before = tree(home);
    const result = runCli(["--apply", "--home", "--apply"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("requires an absolute path");
    expect(tree(home)).toEqual(before);
  });
  test("all shipped agents have valid TOML, required fields, and inherited models", () => {
    for (const name of ["explorer", "worker", "reviewer"]) {
      const agent = Bun.TOML.parse(
        readFileSync(join(sourceRoot, "agents", `${name}.toml.example`), "utf8"),
      ) as Record<string, unknown>;
      expect(agent.name).toBe(name);
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.developer_instructions).toBe("string");
      expect(agent.model).toBeUndefined();
      expect(agent.model_reasoning_effort).toBeUndefined();
      if (name !== "worker") expect(agent.sandbox_mode).toBe("read-only");
    }
    const skill = readFileSync(join(sourceRoot, "crew.skill.md"), "utf8");
    expect(skill).toMatch(/^---\nname: crew\ndescription: .+\n---\n/);
    const metadata = Bun.YAML.parse(
      readFileSync(join(sourceRoot, "crew.metadata.yaml.example"), "utf8"),
    );
    expect(metadata).toMatchObject({ interface: { display_name: "Crew" } });
  });
});

describe("preflight guards", () => {
  test("missing sources fail before any destination is created", () => {
    const before = tree(home);
    expect(() => createPlan(paths, join(sandbox, "missing-source"))).toThrow();
    expect(tree(home)).toEqual(before);
  });
  test("a late missing source fails before writes", () => {
    const copy = join(sandbox, "sources");
    cpSync(sourceRoot, copy, { recursive: true, filter: (path) => !path.includes("node_modules") });
    rmSync(join(copy, "agents", "reviewer.toml.example"));
    expect(() => createPlan(paths, copy)).toThrow();
    expect(readdirSync(home)).toEqual([]);
  });
  test.each(["AGENTS.md", "agents/worker.toml"])("refuses a directory destination: %s", (leaf) => {
    mkdirSync(join(paths.codexHome, leaf), { recursive: true });
    const before = tree(home);
    expect(() => createPlan(paths)).toThrow("regular file");
    expect(tree(home)).toEqual(before);
  });
  test("refuses a regular file in a parent path", () => {
    write(join(paths.codexHome, "agents"), "not a directory");
    expect(() => createPlan(paths)).toThrow();
    expect(readFileSync(join(paths.codexHome, "agents"), "utf8")).toBe("not a directory");
  });
  test.each([false, true])(
    "refuses live and dangling destination symlinks (dangling=%s)",
    (dangling) => {
      mkdirSync(paths.codexHome);
      const outside = join(sandbox, "outside-file");
      if (!dangling) write(outside, "outside contents");
      symlinkSync(outside, join(paths.codexHome, "AGENTS.md"));
      expect(() => createPlan(paths)).toThrow("symlink");
      expect(existsSync(outside)).toBe(!dangling);
      if (!dangling) expect(readFileSync(outside, "utf8")).toBe("outside contents");
    },
  );
  test.each([false, true])("refuses symlinked ancestors (dangling=%s)", (dangling) => {
    const outside = join(sandbox, "outside-directory");
    if (!dangling) mkdirSync(outside);
    symlinkSync(outside, paths.codexHome);
    expect(() => createPlan(paths)).toThrow("symlink");
    if (!dangling) expect(readdirSync(outside)).toEqual([]);
  });
  test("refuses symlinked backup directories", () => {
    mkdirSync(paths.codexHome);
    const outside = join(sandbox, "outside-backups");
    mkdirSync(outside);
    symlinkSync(outside, join(paths.codexHome, "backups"));
    expect(() => createPlan(paths)).toThrow("symlink");
    expect(readdirSync(outside)).toEqual([]);
  });
  test("refuses nonempty overrides but accepts whitespace-only ones", () => {
    const override = join(paths.codexHome, "AGENTS.override.md");
    write(override, "Active override\n");
    expect(() => createPlan(paths)).toThrow("shadow");
    writeFileSync(override, " \n\t");
    expect(createPlan(paths).entries).toHaveLength(6);
  });
  test("refuses dangling override symlinks", () => {
    mkdirSync(paths.codexHome);
    symlinkSync(join(sandbox, "absent"), join(paths.codexHome, "AGENTS.override.md"));
    expect(() => createPlan(paths)).toThrow("symlink");
  });
  test("an unwritable parent fails during preview", () => {
    mkdirSync(paths.codexHome);
    chmodSync(paths.codexHome, 0o500);
    try {
      expect(() => createPlan(paths)).toThrow();
    } finally {
      chmodSync(paths.codexHome, 0o700);
    }
    expect(readdirSync(paths.codexHome)).toEqual([]);
  });
});

describe("apply, backups, reruns, and rollback", () => {
  test("installs all six exact files, preserves unrelated config, and uses private new files", () => {
    const config = join(paths.codexHome, "config.toml");
    write(config, "unrelated = true\n");
    const plan = createPlan(paths);
    const result = applyPlan(plan);
    expect(result.count).toBe(6);
    for (const entry of plan.entries) {
      expect(readFileSync(entry.target).equals(entry.data)).toBe(true);
      expect(lstatSync(entry.target).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(config, "utf8")).toBe("unrelated = true\n");
    expectNoTemporaryArtifacts();
  });
  test("backs up all updates with a recovery map and preserves existing file modes", () => {
    const plan = createPlan(paths);
    for (const entry of plan.entries) {
      write(entry.target, `Original ${entry.source}\n`);
      chmodSync(entry.target, 0o664);
    }
    const update = createPlan(paths);
    const result = applyPlan(update);
    if (!result.backupRoot) throw new Error("Expected backup directory");
    const manifest: { entries: { target: string; backup: string; originalMode: number }[] } =
      JSON.parse(readFileSync(join(result.backupRoot, "manifest.json"), "utf8"));
    expect(manifest.entries).toHaveLength(6);
    for (const entry of update.entries) {
      const recovery = manifest.entries.find((item) => item.target === entry.target);
      if (!recovery) throw new Error("Missing recovery map entry");
      if (!entry.original) throw new Error("Expected an original file");
      expect(
        readFileSync(join(result.backupRoot, recovery.backup)).equals(entry.original.data),
      ).toBe(true);
      expect(lstatSync(join(result.backupRoot, recovery.backup)).mode & 0o777).toBe(0o600);
      expect(recovery.originalMode).toBe(0o664);
      expect(lstatSync(entry.target).mode & 0o777).toBe(0o664);
    }
    expect(lstatSync(result.backupRoot).mode & 0o777).toBe(0o700);
    expectNoTemporaryArtifacts();
  });
  test("a rerun performs no writes, changes no mtimes, and makes no extra backups", () => {
    applyPlan(createPlan(paths));
    const before = tree(home);
    expect(applyPlan(createPlan(paths)).count).toBe(0);
    expect(tree(home)).toEqual(before);
  });
  test("a stale unchanged plan refuses a newly edited destination", () => {
    applyPlan(createPlan(paths));
    const plan = createPlan(paths);
    const target = join(paths.codexHome, "AGENTS.md");
    writeFileSync(target, "New user edit");
    expect(() => applyPlan(plan)).toThrow("changed since preview");
    expect(readFileSync(target, "utf8")).toBe("New user edit");
  });
  test("Codex and skill roots can coincide without double-locking", () => {
    const shared = { codexHome: paths.skillRoot, skillRoot: paths.skillRoot };
    expect(applyPlan(createPlan(shared)).count).toBe(6);
    expectNoTemporaryArtifacts();
  });
  test("preserves existing permissions even under a restrictive umask", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    chmodSync(target, 0o664);
    const previous = process.umask(0o077);
    try {
      applyPlan(createPlan(paths));
    } finally {
      process.umask(previous);
    }
    expect(lstatSync(target).mode & 0o777).toBe(0o664);
  });
  test("atomic replacement does not change another hard link's contents", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    const other = join(sandbox, "other-link");
    linkSync(target, other);
    applyPlan(createPlan(paths));
    expect(readFileSync(other, "utf8")).toBe("Original instructions");
  });
  test("refuses destinations changed between preview and apply", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original");
    const plan = createPlan(paths);
    writeFileSync(target, "New user edit");
    expect(() => applyPlan(plan)).toThrow("changed since preview");
    expect(readFileSync(target, "utf8")).toBe("New user edit");
    expect(existsSync(join(paths.skillRoot, "SKILL.md"))).toBe(false);
    expectNoTemporaryArtifacts();
  });
  test("refuses a destination created between preview and apply", () => {
    const plan = createPlan(paths);
    write(join(paths.codexHome, "AGENTS.md"), "New file");
    expect(() => applyPlan(plan)).toThrow("changed since preview");
    expect(readFileSync(join(paths.codexHome, "AGENTS.md"), "utf8")).toBe("New file");
    expectNoTemporaryArtifacts();
  });
  test("refuses a symlink introduced after preview", () => {
    const plan = createPlan(paths);
    mkdirSync(paths.codexHome);
    symlinkSync(join(sandbox, "outside"), join(paths.codexHome, "AGENTS.md"));
    expect(() => applyPlan(plan)).toThrow("symlink");
    expect(existsSync(join(sandbox, "outside"))).toBe(false);
  });
  test("refuses an override introduced after preview", () => {
    const plan = createPlan(paths);
    write(join(paths.codexHome, "AGENTS.override.md"), "New override");
    expect(() => applyPlan(plan)).toThrow("shadow");
    expect(existsSync(join(paths.codexHome, "AGENTS.md"))).toBe(false);
    expectNoTemporaryArtifacts();
  });
  test.each(["codexHome", "skillRoot"] as const)(
    "respects an existing installation lock: %s",
    (root) => {
      const lock = join(paths[root], ".crew-install.lock");
      mkdirSync(lock, { recursive: true });
      expect(() => applyPlan(createPlan(paths))).toThrow("lock already exists");
      expect(existsSync(lock)).toBe(true);
      expect(existsSync(join(paths.codexHome, "AGENTS.md"))).toBe(false);
    },
  );
  test.each([1, 2, 3, 4, 5, 6])(
    "failure at commit %s restores originals and removes new files",
    (failingCommit) => {
      const target = join(paths.codexHome, "AGENTS.md");
      write(target, "Original instructions");
      chmodSync(target, 0o664);
      const plan = createPlan(paths);
      let calls = 0;
      expect(() =>
        applyPlan(plan, (source, destination) => {
          if (++calls === failingCommit) throw new Error("Injected commit failure");
          renameSync(source, destination);
        }),
      ).toThrow("Destination changes rolled back");
      expect(readFileSync(target, "utf8")).toBe("Original instructions");
      expect(lstatSync(target).mode & 0o777).toBe(0o664);
      for (const entry of plan.entries.slice(1)) expect(existsSync(entry.target)).toBe(false);
      expectNoTemporaryArtifacts();
      expect(applyPlan(createPlan(paths)).count).toBe(6);
    },
  );
  test("reports incomplete rollback and retains recoverable originals", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    let calls = 0;
    expect(() =>
      applyPlan(createPlan(paths), (source, destination) => {
        if (++calls >= 2) throw new Error("Injected persistent failure");
        renameSync(source, destination);
      }),
    ).toThrow("Rollback incomplete");
    const backups = join(paths.codexHome, "backups");
    const backup = readdirSync(backups)[0];
    if (!backup) throw new Error("Expected retained recovery files");
    expect(readFileSync(join(backups, backup, "0-original"), "utf8")).toBe("Original instructions");
    expect(existsSync(join(backups, backup, "manifest.json"))).toBe(true);
    expectNoTemporaryArtifacts();
  });
  test("rollback preserves a concurrent user edit and reports recovery is needed", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    let calls = 0;
    expect(() =>
      applyPlan(createPlan(paths), (source, destination) => {
        if (++calls === 2) {
          writeFileSync(target, "Concurrent user edit");
          throw new Error("Injected commit failure");
        }
        renameSync(source, destination);
      }),
    ).toThrow("concurrently changed");
    expect(readFileSync(target, "utf8")).toBe("Concurrent user edit");
    expectNoTemporaryArtifacts();
  });
  test("rollback preserves a concurrent permission change", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    let calls = 0;
    expect(() =>
      applyPlan(createPlan(paths), (source, destination) => {
        if (++calls === 2) {
          chmodSync(target, 0o400);
          throw new Error("Injected commit failure");
        }
        renameSync(source, destination);
      }),
    ).toThrow("concurrently changed");
    expect(lstatSync(target).mode & 0o777).toBe(0o400);
    expectNoTemporaryArtifacts();
  });
  test("an override appearing during commit triggers rollback", () => {
    const target = join(paths.codexHome, "AGENTS.md");
    write(target, "Original instructions");
    let calls = 0;
    expect(() =>
      applyPlan(createPlan(paths), (source, destination) => {
        renameSync(source, destination);
        if (++calls === 1) write(join(paths.codexHome, "AGENTS.override.md"), "New override");
      }),
    ).toThrow("shadow");
    expect(readFileSync(target, "utf8")).toBe("Original instructions");
    expect(existsSync(join(paths.skillRoot, "SKILL.md"))).toBe(false);
    expectNoTemporaryArtifacts();
  });
});
