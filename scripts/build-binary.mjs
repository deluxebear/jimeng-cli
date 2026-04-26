#!/usr/bin/env node
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const buildDir = join(root, ".build");
const distDir = join(root, "dist");
const platform = process.platform;
const arch = process.arch;
const binaryName = platform === "win32" ? `jimeng-${platform}-${arch}.exe` : `jimeng-${platform}-${arch}`;
const bundlePath = join(buildDir, "jimeng-sea.cjs");
const blobPath = join(buildDir, "jimeng-sea.blob");
const configPath = join(buildDir, "sea-config.json");
const binaryPath = join(distDir, binaryName);
const nodeMajor = Number(process.versions.node.split(".")[0]);

if (nodeMajor < 22) {
  throw new Error(`build:binary requires Node 22 or newer; current Node is ${process.version}`);
}

function postjectBin() {
  return platform === "win32"
    ? join(root, "node_modules", ".bin", "postject.cmd")
    : join(root, "node_modules", ".bin", "postject");
}

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 20,
    ...options
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

async function maybeCodesign(args) {
  if (platform !== "darwin") return;
  try {
    await run("codesign", args);
  } catch (error) {
    if (args.includes("--remove-signature")) return;
    throw error;
  }
}

await rm(buildDir, { recursive: true, force: true });
await mkdir(buildDir, { recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(root, "bin", "jimeng.mjs")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["playwright"],
  legalComments: "none",
  logLevel: "silent"
});

await writeFile(configPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true
}, null, 2));

await run(process.execPath, ["--experimental-sea-config", configPath]);
await copyFile(process.execPath, binaryPath, constants.COPYFILE_FICLONE);
await maybeCodesign(["--remove-signature", binaryPath]);
const postjectArgs = [
  binaryPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];
if (platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
await run(postjectBin(), postjectArgs);
await maybeCodesign(["-s", "-", binaryPath]);

console.log(JSON.stringify({
  ok: true,
  binary: binaryPath,
  name: basename(binaryPath),
  platform,
  arch
}, null, 2));
