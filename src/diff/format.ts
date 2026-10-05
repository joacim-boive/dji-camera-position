import { formatLeaf } from "../json.js";
import type { SemanticDiff } from "./semantic-diff.js";

export function formatSemanticDiff(
  diff: SemanticDiff,
  maxChanges = 200,
): string {
  const lines: string[] = [];
  const shown = diff.changes.slice(0, maxChanges);
  const changed = shown.filter((change) => change.kind === "changed");
  const added = shown.filter((change) => change.kind === "added");
  const removed = shown.filter((change) => change.kind === "removed");

  lines.push(
    `${diff.changes.length} semantic change${diff.changes.length === 1 ? "" : "s"}, ${diff.noise.length} suppressed as likely noise.`,
  );

  if (diff.changes.length === 0) {
    lines.push("");
    lines.push("No semantic changes after noise filtering.");
  }

  if (changed.length > 0) {
    lines.push("");
    lines.push("Changed values:");
    lines.push("");
    for (const change of changed) {
      lines.push(change.path);
      lines.push(`  before: ${formatLeaf(change.before)}`);
      lines.push(`  after:  ${formatLeaf(change.after)}`);
      if (change.hypothesis !== undefined) {
        lines.push(`  candidate: ${change.hypothesis.candidate}`);
        lines.push(`  confidence: ${change.hypothesis.confidence}`);
        lines.push(`  reason: ${change.hypothesis.reason}`);
      }
      if (change.shape !== undefined) {
        lines.push(`  shape: ${change.shape}`);
      }
      lines.push("");
    }
  }

  if (added.length > 0) {
    lines.push("Added:");
    lines.push("");
    for (const change of added) {
      lines.push(change.path);
      lines.push(`  after: ${formatLeaf(change.after)}`);
      lines.push("");
    }
  }

  if (removed.length > 0) {
    lines.push("Removed:");
    lines.push("");
    for (const change of removed) {
      lines.push(change.path);
      lines.push(`  before: ${formatLeaf(change.before)}`);
      lines.push("");
    }
  }

  if (diff.changes.length > shown.length) {
    lines.push(`Showing ${shown.length} of ${diff.changes.length} changes.`);
    lines.push("");
  }

  if (diff.noise.length > 0) {
    lines.push(`Suppressed likely noise: ${diff.noise.length}`);
    for (const hit of diff.noise.slice(0, 30)) {
      lines.push(`  ${hit.path} (${hit.reason})`);
    }
    if (diff.noise.length > 30) {
      lines.push(`  ... ${diff.noise.length - 30} more`);
    }
    lines.push("Use --show-noise to print those changes too.");
  }

  return lines.join("\n").trimEnd();
}
