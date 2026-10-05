import type { Command } from "commander";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { startUiServer } from "../ui/server.js";

const execFileAsync = promisify(execFile);

export function registerUiCommand(program: Command): void {
  program
    .command("ui")
    .description(
      "Open the local framing desk. It writes a draft only when you press Write.",
    )
    .option("--port <number>", "localhost port", "3921")
    .option("--no-open", "do not open a browser")
    .action(async (options: { port: string; open?: boolean }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("--port must be an integer from 1 to 65535.");
      }
      const ui = await startUiServer({
        port,
        projectRoot: path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "DJI Studio",
          "project",
        ),
      });
      process.stdout.write(`${ui.url}\n`);
      process.stdout.write("Quit DJI Studio before pressing Write.\n");
      if (options.open !== false && process.platform === "darwin") {
        await execFileAsync("open", [ui.url]);
      }
    });
}
