import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function run(script, env = process.env) {
  const child = spawn(process.execPath, [script], { env, stdio: "inherit" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(Error(`${script} failed (${code ?? signal})`)),
    );
  });
}
// The workflow test owns and cleans its own temporary headquarters database.
await run("tests/workflow.mjs");
const dir = mkdtempSync(join(tmpdir(), "mcw-owner-check-"));
const port = Number(process.env.TEST_MOBILE_PORT || 3100);
const server = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATA_DIR: dir,
    ADMIN_PASSWORD: "",
    GEOCODE_ON_START: "false",
    PERSIST_DRIVER: "none",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Production test service did not start")),
      10000,
    );
    server.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(
        Error(
          "Production test service exited before startup; check port availability",
        ),
      );
    });
    server.stdout.on("data", (chunk) => {
      if (
        chunk.toString().includes(`MCW laundry map listening on port ${port}`)
      ) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  await run("tests/mobile.mjs", {
    ...process.env,
    TEST_BASE_URL: `http://127.0.0.1:${port}`,
  });
  await run("tests/taiwan-overview.mjs", {
    ...process.env,
    TEST_BASE_URL: `http://127.0.0.1:${port}`,
  });
  console.log(
    "Both browser suites passed. Production fixture and isolated data are cleaned up.",
  );
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  rmSync(dir, { recursive: true, force: true });
}
