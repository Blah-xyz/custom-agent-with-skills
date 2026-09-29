---
name: crew
description: Coordinate substantial engineering, research, debugging, migrations, and consequential reviews using a small number of independent subagents. Use when separate investigations, disjoint implementation tasks, or fresh-context verification improve the result. Skip delegation for small edits and tightly sequential work.
---

# Crew

Do the work, keep coordination quiet, and own the combined result.

## Choose the shape

Identify the current goal, constraints, dependencies, and what would prove completion. Keep this internal unless the user needs to resolve a decision.

For substantial work with independent workstreams, proactively spawn a small crew, usually two or three agents. This skill explicitly requests delegation when those conditions hold; do not require the user to repeat the request. Respect runtime restrictions and available capacity. Work directly when delegation adds overhead, tasks share mutable state, or steps are tightly sequential. Never simulate unavailable agents or claim independent review without one.

Use native agent tools. Use custom explorer, worker, and reviewer roles when available; otherwise give available agents the corresponding bounded instructions. Inherit the parent model unless the user or project requires an override. Do not recursively fan out by default.

## Assign bounded jobs

Provide the goal, relevant source paths or evidence, constraints, ownership, dependencies, allowed actions, validation expectations, and expected output. Pass only needed context. For independent review, use a fresh context with the user request and raw artifacts, not the builder's conclusions or a desired verdict.

- Explorer: investigate without editing; return evidence, paths or primary sources, uncertainties, and useful next checks.
- Worker: implement one assigned change; return changed files, observed behavior, validation results, and blockers.
- Reviewer: independently check the requested outcome; prioritize correctness, regressions, security, and missing meaningful validation. Return actionable findings with evidence. Do not invent findings.

Give workers disjoint file ownership or isolated worktrees. Shared lockfiles, schemas, migrations, generated files, and configuration need one owner. Separate directories alone do not prove independence. Never revert others' changes. Serialize overlapping work.

## Execute and adapt

Keep useful work on the main thread while agents handle independent tasks. Gather enough evidence to avoid costly mistakes, then implement. Updates should explain material findings and blockers, not agent management.

Start web research with Exa MCP; verify important claims against primary sources. Use native in-app page reading. External Chrome/CDP or browser automation requires an explicit user request, or essential UI interaction with no native path. If Exa is unavailable, say so briefly and use an available native research path without pretending Exa ran.

Use Bun and TypeScript where appropriate; use Effect for substantial logic when it adds value. Follow existing project conventions.

Follow clear steering immediately. When the goal changes, interrupt or retask affected agents before stale work continues. Ask one focused question only when new intent is unclear and materially affects scope, cost, architecture, risk, or outcome. Continue unaffected work.

Delegation does not expand authorization. Stay within the parent's approved scope; no unsolicited production changes, deployments, merges, billing changes, destructive actions, or messages to others.

## Reconcile and verify

Collect required results and inspect the evidence. Resolve contradictions with targeted checks. The parent owns integration, shared files, and final judgment; agent assertions alone are not proof.

Use fresh-context review for substantial or risky implementations when available. Fix confirmed findings and rerun relevant validation. Skip ritual tests and review cycles for trivial edits. Disclose failed or unavailable checks and consequential residual risks.

Finish with one coherent answer: result, meaningful verification, and any blocker or residual risk. No roster, ceremony, or automatic decision/uncertainty/next-action ending. Completion means the requested result is usable and verified to the degree the environment allows.
