import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { bundledFfmpeg } from "../src/ui/ffmpeg-bin.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(root, "build", "cache");
const sourceDir = path.join(cacheDir, `ffmpeg-${bundledFfmpeg.version}`);
const tarball = path.join(cacheDir, `ffmpeg-${bundledFfmpeg.version}.tar.xz`);
const resourcesDir = path.join(root, "build", "resources");
const binary = path.join(resourcesDir, "ffmpeg");
const stampPath = path.join(resourcesDir, "ffmpeg-build.txt");

const stamp = `${bundledFfmpeg.version}\n${bundledFfmpeg.configure.join(" ")}\n`;

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The Frame Desk build is for macOS.");
  }
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(
      `This build supports arm64 and x64. This machine is ${process.arch}.`,
    );
  }
  await ensureFfmpeg();
  await run("pnpm", ["exec", "tsc"], root);
  const publicOut = path.join(root, "dist", "ui", "public");
  await rm(publicOut, { recursive: true, force: true });
  await cp(path.join(root, "src", "ui", "public"), publicOut, {
    recursive: true,
  });
  await copyFile(
    path.join(root, "LICENSE"),
    path.join(publicOut, "legal", "MIT.txt"),
  );
  await run(
    "pnpm",
    ["exec", "electron-builder", "--mac", `--${process.arch}`],
    root,
  );
}

async function ensureFfmpeg(): Promise<void> {
  if (await stampMatches()) {
    process.stdout.write(`ffmpeg ${bundledFfmpeg.version} is already built.\n`);
    return;
  }
  await mkdir(cacheDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  if (!(await fileExists(tarball))) {
    process.stdout.write(`Downloading ${bundledFfmpeg.sourceUrl}\n`);
    await download(bundledFfmpeg.sourceUrl, tarball);
  }
  await rm(sourceDir, { recursive: true, force: true });
  await run("tar", ["-xJf", tarball, "-C", cacheDir], root);
  process.stdout.write(
    `Building LGPL ffmpeg ${bundledFfmpeg.version} (${process.arch}).\n`,
  );
  await run(
    path.join(sourceDir, "configure"),
    [...bundledFfmpeg.configure],
    sourceDir,
  );
  await run(
    "make",
    ["-j", String(os.availableParallelism()), "ffmpeg"],
    sourceDir,
  );
  const built = path.join(sourceDir, "ffmpeg");
  if (!(await fileExists(built))) {
    throw new Error("The ffmpeg build did not produce a binary.");
  }
  await copyFile(built, binary);
  await chmod(binary, 0o755);
  await writeFile(stampPath, stamp, "utf8");
}

async function stampMatches(): Promise<boolean> {
  if (!(await fileExists(binary)) || !(await fileExists(stampPath))) {
    return false;
  }
  const saved = await readFile(stampPath, "utf8");
  return saved === stamp;
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Could not download ${url}.`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with status ${String(code)}.`));
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
