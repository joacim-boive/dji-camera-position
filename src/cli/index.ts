#!/usr/bin/env node
import { Command } from "commander";
import { comparePaths, formatComparison } from "../diff/compare.js";
import { formatDiscoverReport } from "../discovery/format.js";
import { discover } from "../discovery/scan.js";
import { inspectTarget, keysTarget, searchTarget } from "../parser/inspect.js";
import { resolveUserPath } from "../paths.js";
import { registerPresetCommands } from "./preset.js";
import { registerUiCommand } from "./ui.js";
import { registerViewCommands } from "./view.js";

const program = new Command();

program
  .name("dji")
  .description(
    "Inspect DJI Studio projects and copy virtual-camera settings between clips.",
  )
  .version("0.0.1")
  .addHelpText(
    "after",
    "\nview set, view copy, preset apply, and the framing desk modify a project only when a write is requested. Quit DJI Studio first.\n",
  );

program
  .command("discover")
  .description(
    "Search likely macOS locations for DJI Studio files. Does not modify anything.",
  )
  .option("--home <path>", "home directory to scan")
  .option("--json", "print the report as JSON")
  .action(async (options: { home?: string; json?: boolean }) => {
    const report = await discover({
      ...(options.home === undefined
        ? {}
        : { homeDir: resolveUserPath(options.home) }),
    });
    process.stdout.write(
      `${options.json === true ? JSON.stringify(report, null, 2) : formatDiscoverReport(report)}\n`,
    );
  });

program
  .command("inspect")
  .description(
    "Identify a project file or directory and describe its structure.",
  )
  .argument("<project-or-file>", "file or directory to inspect")
  .option("--full", "print more paths and the full JSON text")
  .option("--max-paths <count>", "maximum JSON paths to preview", "40")
  .action(
    async (target: string, options: { full?: boolean; maxPaths: string }) => {
      const text = await inspectTarget(resolveUserPath(target), {
        full: options.full === true,
        maxPaths: parsePositiveInt(options.maxPaths, "--max-paths"),
      });
      process.stdout.write(`${text}\n`);
    },
  );

program
  .command("keys")
  .description("List JSON, plist, or SQLite value paths.")
  .argument("<project-or-file>", "file or directory to read")
  .option("--all", "do not limit the number of paths")
  .option("--max-paths <count>", "maximum paths per file", "400")
  .action(
    async (target: string, options: { all?: boolean; maxPaths: string }) => {
      const maxPaths =
        options.all === true
          ? undefined
          : parsePositiveInt(options.maxPaths, "--max-paths");
      const text = await keysTarget(resolveUserPath(target), maxPaths);
      process.stdout.write(`${text}\n`);
    },
  );

program
  .command("search")
  .description(
    "Search keys and values. The query is a case-insensitive substring.",
  )
  .argument("<project-or-file>", "file or directory to read")
  .argument("<query>", "text to find")
  .option("--max-matches <count>", "maximum matches", "80")
  .action(
    async (target: string, query: string, options: { maxMatches: string }) => {
      const text = await searchTarget(
        resolveUserPath(target),
        query,
        parsePositiveInt(options.maxMatches, "--max-matches"),
      );
      process.stdout.write(`${text}\n`);
    },
  );

program
  .command("diff")
  .description(
    "Compare two project files or directories, hiding likely timestamps, ids, and paths.",
  )
  .argument("<before>", "earlier file or directory")
  .argument("<after>", "later file or directory")
  .option("--show-noise", "include values that the noise filter would hide")
  .option("--max-changes <count>", "maximum changes to print per file", "200")
  .action(
    async (
      before: string,
      after: string,
      options: { showNoise?: boolean; maxChanges: string },
    ) => {
      const maxChanges = parsePositiveInt(options.maxChanges, "--max-changes");
      const report = await comparePaths(
        resolveUserPath(before),
        resolveUserPath(after),
        {
          includeNoise: options.showNoise === true,
          maxChanges,
        },
      );
      process.stdout.write(`${formatComparison(report, maxChanges)}\n`);
    },
  );

registerViewCommands(program);
registerPresetCommands(program);
registerUiCommand(program);

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
