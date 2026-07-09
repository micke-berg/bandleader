import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface SpawnStreamOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LineStream {
  lines: AsyncIterable<string>;
  /** Resolves with the exit code and captured stderr once the process ends. */
  exit: Promise<{ code: number | null; stderr: string }>;
}

const STDERR_CAP_BYTES = 16 * 1024;

/**
 * Spawn a CLI and expose its stdout as an async iterable of lines.
 * stderr is captured (capped) for diagnostics on failure.
 */
export function spawnLineStream(
  command: string,
  args: string[],
  options: SpawnStreamOptions = {},
): LineStream {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < STDERR_CAP_BYTES) {
      stderr += chunk.toString("utf8");
    }
  });

  const exit = new Promise<{ code: number | null; stderr: string }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
    },
  );
  // The caller always awaits `exit` after the line loop, but if the loop
  // throws first we must not crash the process with an unhandled rejection.
  exit.catch(() => {});

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  return { lines, exit };
}
