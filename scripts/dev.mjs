import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(python)) {
  console.error("Set up the Python environment first. See README.md.");
  process.exit(1);
}
const children = [];
let stopping = false;
function start(executable, args, cwd = root) {
  const child = spawn(executable, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start(python, [
  "-m",
  "uvicorn",
  "backend.app.main:app",
  "--host",
  "127.0.0.1",
  "--port",
  "8765",
]);
let apiReady = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt += 1) {
  try {
    const response = await fetch("http://127.0.0.1:8765/api/health");
    if (response.ok) {
      apiReady = true;
      break;
    }
  } catch {
    /* The API process is still starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!apiReady) {
  console.error(
    "The local music API did not start. See the Python output above.",
  );
  stop(1);
}
if (apiReady) start(python, ["-m", "backend.worker"]);
if (apiReady)
  start(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    path.join(root, "apps/web"),
  );
