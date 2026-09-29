import { applyPlan, createPlan, parseArguments, resolvePaths, USAGE } from "./installer";

export function main(args: readonly string[]): void {
  const options = parseArguments(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const paths = resolvePaths(options);
  const plan = createPlan(paths);
  console.log(`Codex home: ${paths.codexHome}`);
  console.log(`Crew skill: ${paths.skillRoot}`);
  for (const entry of plan.entries) console.log(`${entry.action.padEnd(9)} ${entry.target}`);
  if (plan.entries.some((entry) => entry.action === "UPDATE")) {
    console.log(
      "\nUPDATE replaces the whole file; existing contents will be backed up, not merged.",
    );
  }
  if (!options.apply) {
    console.log("\nPreview only; nothing written. Run again with --apply to install.");
    return;
  }
  const result = applyPlan(plan);
  if (result.count === 0) {
    console.log("\nAlready installed; no changes.");
    return;
  }
  console.log(
    `\nInstalled ${result.count} files. Recovery manifest: ${result.backupRoot}/manifest.json`,
  );
  console.log("Open a new Codex conversation to verify instructions, Crew, and agent discovery.");
}

// Importing this module for checks never runs the installer.
if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Crew install failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
