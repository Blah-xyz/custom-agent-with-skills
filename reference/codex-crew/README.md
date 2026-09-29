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

Apply explicitly:

```sh
bun reference/codex-crew/install.ts --apply
```

The installer uses Bun with TypeScript and no package dependencies. It preserves unrelated configuration, skips identical files, and backs up changed existing destinations under the Codex home before replacing them. It refuses symlinked destinations and nonempty global `AGENTS.override.md` files. It respects `CODEX_HOME` for guidance and agent destinations; `--home /path` selects a separate home for isolated verification and ignores `CODEX_HOME`.

The installer changes global defaults for future local Codex sessions. It does not install Exa MCP or change browser/MCP settings, approval controls, model selection, or project configuration. The agents inherit model settings, explorer and reviewer request read-only sandboxes, and existing project agents may take precedence. Runtime restrictions still govern delegation and actual sandbox behavior.

## Verify

In a new local Codex conversation, ask it to identify the global instructions, locate `crew`, and list the explorer, worker, and reviewer roles. Ask it to use Crew on a real task with independent workstreams; small edits should remain direct.

The files were syntax-checked and the installer was exercised against an isolated home. No access to Vince's Mac home directory was available in the authoring session; these reference copies alone do not mean its global configuration was installed.

## Sources checked

- [Global instruction discovery](https://developers.openai.com/codex/guides/agents-md)
- [Skill discovery and metadata](https://developers.openai.com/codex/skills)
- [Custom agent schema and inheritance](https://developers.openai.com/codex/subagents)
