#!/usr/bin/env node
// Optional Keepsake step: open the reviewed album in a local Storyboard editor.
//
// node edit.mjs <work>/album.json [--project file] [--out folder] [--port 4179] [--no-open]

import { spawn } from "node:child_process";
import path from "node:path";
import { defaultProjectPath } from "./editor-project.mjs";
import { startEditorServer } from "./editor-server.mjs";

const args = process.argv.slice(2);
const albumArg = args[0];
if (!albumArg || albumArg.startsWith("--")) {
  console.error("Usage: node edit.mjs <work>/album.json [--project file] [--out folder] [--port 4179] [--no-open]");
  process.exit(1);
}
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const albumPath = path.resolve(albumArg);
const projectPath = path.resolve(option("--project") || defaultProjectPath(albumPath));
const outputPath = option("--out") ? path.resolve(option("--out")) : undefined;
const port = Number(option("--port") || 4179);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a valid TCP port.");

const editor = await startEditorServer({ albumPath, projectPath, outputPath, port });
console.log(`Keepsake local editor: ${editor.url}`);
console.log(`Project: ${editor.context.projectPath}`);
console.log("The editor runs only on 127.0.0.1. Press Ctrl+C to stop it.");

if (!args.includes("--no-open")) {
  const command = process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", ["/c", "start", "", editor.url]]
    : process.platform === "darwin"
      ? ["open", [editor.url]]
      : ["xdg-open", [editor.url]];
  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
