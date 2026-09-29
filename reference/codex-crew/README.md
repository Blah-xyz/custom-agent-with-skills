# Crew: inert Codex setup copies

These files are references, not active project configuration. Merely opening this repository does not install them. They are outside `skills/`, `.agents/skills/`, and `.codex/agents/`; there is no `AGENTS.md` or `SKILL.md` in this reference directory. Do not register these files as config layers, instruction fallbacks, or skill paths. Nothing here is wired into the repository's Python agent.

| Reference | Explicit installation destination |
| --- | --- |
| `global-instructions.md` | `~/.codex/AGENTS.md` |
| `crew.skill.md` | `~/.agents/skills/crew/SKILL.md` |
| `crew.metadata.yaml.example` | `~/.agents/skills/crew/agents/openai.yaml` |
| `agents/explorer.toml.example` | `~/.codex/agents/explorer.toml` |
| `agents/worker.toml.example` | `~/.codex/agents/worker.toml` |
| `agents/reviewer.toml.example` | `~/.codex/agents/reviewer.toml` |

The five requested authored files are the guidance, skill, and three agents. The YAML provides optional skill UI metadata.

## Install on your own machine

From the repository root, preview:

```sh
bun reference/codex-crew/install.ts
```

Or explicitly select the same preview mode:

```sh
bun reference/codex-crew/install.ts --dry-run
```

Both previews read and validate the inputs and destinations without changing installation files or creating directories. They show each exact destination and whether it will be created, replaced, or left unchanged. Bun itself may maintain its normal runtime cache. `--help` prints usage without inspecting destinations.

Apply explicitly:

```sh
bun reference/codex-crew/install.ts --apply
```

The installer runs directly with Bun and has no runtime package dependencies. The development dependencies below are only for typechecking and linting.

### Paths and existing files

- Empty or unset `CODEX_HOME` defaults to the OS user home plus `.codex`.
- An absolute `CODEX_HOME` redirects instructions and agents. The personal skill still goes in the OS user home's `.agents/skills/crew` directory, matching user-scoped skill discovery.
- `--home /absolute/path` redirects both locations: `/absolute/path/.codex` and `/absolute/path/.agents/skills/crew`. It ignores `CODEX_HOME` and is the supported way to isolate an install.
- Relative paths, literal unexpanded `~`, missing option values, duplicate options, unknown options, and a combination of `--apply` and `--dry-run` are rejected.
- Symlinked destinations and ancestors, including dangling symlinks and symlinked backup paths, are refused. On macOS, `/tmp` and `/var` are symlinks; pass their canonical paths when using them for an isolated home.
- Nonempty global `AGENTS.override.md` files are refused because they would shadow the installed instructions.

**Changed existing destination files are replaced in full, not merged.** This includes global `AGENTS.md` and any existing explorer, worker, or reviewer files. Review their contents before applying if you have customizations to keep. Other configuration, including `config.toml`, remains untouched. Identical destinations are skipped, with no new backups or modification-time changes.

### Writes and recovery

The installer checks source files, destination types, and parent writability before applying. It locks both the Codex home and the Crew skill directory, then rechecks destination contents and file identity before replacement. Locks coordinate instances of this installer; unrelated editors do not participate in them.

Before changing any destination, it creates a private recovery directory under `<Codex home>/backups/crew-<unique suffix>/`. `manifest.json` maps each changed destination to its original backup and records its original permission bits. A `null` backup means the destination did not previously exist. Backups use mode `0600` inside a `0700` directory. Newly installed files use `0600`; replacements preserve the existing file's permission bits.

All new contents are staged beside their destination, then installed using atomic per-file renames. A caught installation failure triggers rollback of completed replacements and removes newly created destination files. Rollback refuses to overwrite a detected concurrent edit. Recovery files are retained, and incomplete rollback or cleanup failures produce a nonzero exit status with an explanation. Successful installs print the recovery manifest location.

This is not a single operating-system transaction across all six files. An abrupt process kill, power loss, or a failure during rollback can require manual recovery. Consult the manifest to restore original files and their modes; remove files with `null` backups only after checking for subsequent edits. If a lock remains after an interrupted run, verify no installer is running before removing that `.crew-install.lock` directory. Atomic replacement preserves permission bits but does not promise to preserve ownership, ACLs, extended attributes, or modification times of replaced files.

The installer changes global defaults for future local Codex sessions. It does not install Exa MCP or change browser/MCP settings, approval controls, model selection, or project configuration. The agents inherit model settings, explorer and reviewer request read-only sandboxes, and existing project agents may take precedence. Runtime restrictions still govern delegation and actual sandbox behavior.

## Verify

In a new local Codex conversation, ask it to identify the global instructions, locate `crew`, and list the explorer, worker, and reviewer roles. Ask it to use Crew on a real task with independent workstreams; small edits should remain direct.

The automated checks below use disposable canonical temporary homes. CLI test subprocesses receive a fake `HOME` and `CODEX_HOME`, with Bun's runtime cache routed outside the installation directories. Apply tests do not write to your real Codex setup. An isolated installation passing tests does not establish that a running Codex client has discovered the installed configuration.

## Development checks

From the repository root:

```sh
cd reference/codex-crew
bun install --frozen-lockfile
bun run check
```

`check` runs strict TypeScript checking, Biome lint/format checks, and Bun tests. The pinned tooling and lockfile are scoped to this reference directory; the repository's Python agent and dependencies are unchanged.

Tests cover default and explicit dry runs, home/environment selection, invalid arguments, template formats, missing sources, destination and ancestor types, live and dangling symlinks, overrides, unwritable parents, exact installed bytes, private backups, preservation of unrelated configuration and file modes, idempotent reruns, stale plans, installation locks, failures at every commit position, complete and incomplete rollback, and concurrent user edits.

## Sources checked

- [Global instruction discovery](https://developers.openai.com/codex/guides/agents-md)
- [Skill discovery and metadata](https://developers.openai.com/codex/skills)
- [Custom agent schema and inheritance](https://developers.openai.com/codex/subagents)
