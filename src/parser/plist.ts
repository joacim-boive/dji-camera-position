import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseJsonText } from "../json.js";

const execFileAsync = promisify(execFile);

export async function readPlistJson(filePath: string): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", filePath], {
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    return parseJsonText(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not decode plist ${filePath}: ${message}`);
  }
}
