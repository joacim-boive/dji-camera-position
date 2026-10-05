import { displayPath, formatBytes, formatModified } from "../paths.js";
import type { DiscoverReport, DiscoveredFile } from "./scan.js";

const PROJECT_FILE =
  /(?:^|\/)(draft\.json|manifest\.json|project_settings\.json|proj\.db|config\.ini|project\.meta)$/;

export function formatDiscoverReport(report: DiscoverReport): string {
  const lines: string[] = ["DJI Studio discovery (read-only)", ""];

  lines.push("Installed apps:");
  if (report.apps.length === 0) {
    lines.push("  none found in the application directories");
  }
  for (const app of report.apps) {
    const version = [app.version, app.build]
      .filter((part) => part !== undefined)
      .join(" / ");
    lines.push(`  ${app.name}${version.length > 0 ? `  ${version}` : ""}`);
    lines.push(`    ${displayPath(app.path)}`);
    if (app.bundleId !== undefined) {
      lines.push(`    bundle id: ${app.bundleId}`);
    }
  }

  lines.push("");
  lines.push("Match tokens from installed apps:");
  lines.push(
    report.tokens.length === 0
      ? "  (none; matching DJI and Osmo names only)"
      : `  ${report.tokens.join(", ")}`,
  );

  lines.push("");
  lines.push("Roots:");
  for (const root of report.roots) {
    lines.push(
      `  ${displayPath(root.path)}  ${root.exists ? "exists" : "missing"}`,
    );
  }

  if (report.locations.length === 0) {
    lines.push("");
    lines.push("No DJI or Osmo locations matched.");
    return lines.join("\n");
  }

  for (const location of report.locations) {
    lines.push("");
    lines.push(displayPath(location.path));
    if (location.error !== undefined) {
      lines.push(`  error: ${location.error}`);
      continue;
    }
    const likely = location.files.filter(
      (file) =>
        PROJECT_FILE.test(file.relativePath) ||
        file.relativePath.includes("draft.proj"),
    );
    const others = location.files.filter((file) => !likely.includes(file));
    if (likely.length > 0) {
      lines.push("  Likely project files:");
      for (const file of likely) {
        lines.push(formatFile(file));
      }
    }
    if (others.length > 0) {
      lines.push(`  Other interesting files: ${others.length}`);
      for (const file of others.slice(0, 40)) {
        lines.push(formatFile(file));
      }
      if (others.length > 40) {
        lines.push(`    ... ${others.length - 40} more`);
      }
    }
    if (location.files.length === 0) {
      lines.push("  no interesting files recorded");
    }
    if (location.summaries.length > 0) {
      lines.push("  Directories not listed file-by-file:");
      for (const summary of location.summaries) {
        if (summary.reason === "skipped-bulky") {
          lines.push(
            `    ${summary.relativePath}  skipped (cache, log, or crash data)`,
          );
          continue;
        }
        const extensions = Object.entries(summary.extensionCounts)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 6)
          .map(([extension, count]) => `${extension} ${count}`)
          .join(", ");
        lines.push(
          `    ${summary.relativePath}  ${summary.directoryCount} dirs, ${summary.fileCount} files${extensions.length > 0 ? ` (${extensions})` : ""}`,
        );
      }
    }
    if (location.unreadable.length > 0) {
      lines.push(`  unreadable files skipped: ${location.unreadable.length}`);
    }
    if (location.truncated) {
      lines.push("  listing truncated");
    }
  }

  lines.push("");
  lines.push("Discovery does not modify files.");
  return lines.join("\n");
}

function formatFile(file: DiscoveredFile): string {
  return `    ${file.relativePath}  ${file.fileType}  ${formatBytes(file.bytes)}  ${formatModified(file.modifiedAtMs)}`;
}
