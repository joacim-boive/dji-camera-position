import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readDraftViews, resolveDraftFile } from "../model/draft-document.js";

export type ProjectSummary = {
  id: string;
  projectPath: string;
  draftPath: string;
  generation: string;
  modifiedAt: string;
  clipCount: number;
  signatureMatches: boolean;
  error?: string;
};

export async function listDraftProjects(
  root: string,
): Promise<ProjectSummary[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }

  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const projectPath = path.join(root, entry.name);
    try {
      const draftPath = await resolveDraftFile(projectPath);
      const info = await stat(draftPath);
      const report = await readDraftViews(draftPath);
      projects.push({
        id: entry.name,
        projectPath,
        draftPath,
        generation: path.basename(path.dirname(draftPath)),
        modifiedAt: new Date(info.mtimeMs).toISOString(),
        clipCount: report.clips.length,
        signatureMatches: report.signatureMatches,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("No draft.json")) {
        continue;
      }
      projects.push({
        id: entry.name,
        projectPath,
        draftPath: projectPath,
        generation: "—",
        modifiedAt: new Date(0).toISOString(),
        clipCount: 0,
        signatureMatches: false,
        error: message,
      });
    }
  }

  projects.sort((left, right) =>
    right.modifiedAt.localeCompare(left.modifiedAt),
  );
  return projects;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
