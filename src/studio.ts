import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function assertStudioQuit(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  if (await studioIsRunning()) {
    throw new Error("DJI Studio is running. Quit it before writing a project.");
  }
}

export async function studioIsRunning(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", "DJIStudio"]);
    return stdout.trim().length > 0;
  } catch (error) {
    if (exitCode(error) === 1) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not check whether DJI Studio is running. ${message}`,
    );
  }
}

function exitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  if (typeof code === "number") {
    return code;
  }
  if (typeof code === "string") {
    const parsed = Number(code);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}
