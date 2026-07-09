import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  RouteRequest,
  Verifier,
  VerifierContext,
  VerifierResult,
} from "./types";

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 1_500;

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL_CHARS
    ? `…${trimmed.slice(-OUTPUT_TAIL_CHARS)}`
    : trimmed;
}

/**
 * Layer 4 ground truth, v1: run the configured shell commands in the
 * task's cwd and require them all to exit 0. Mechanical checks
 * (typecheck, tests, build) are what gate escalation — never the model's
 * own opinion of its work.
 *
 * Applies only to repo tasks with a cwd; chat has nothing to verify.
 */
export class ShellVerifier implements Verifier {
  readonly name = "shell";
  private readonly commands: string[];

  constructor(commands: string[]) {
    this.commands = commands;
  }

  applies(request: RouteRequest): boolean {
    return (
      request.kind === "task" &&
      request.cwd !== undefined &&
      this.commands.length > 0
    );
  }

  async verify(ctx: VerifierContext): Promise<VerifierResult> {
    for (const command of this.commands) {
      try {
        await execFileAsync("/bin/sh", ["-c", command], {
          cwd: ctx.cwd,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
        });
      } catch (err) {
        const output =
          typeof err === "object" && err !== null
            ? `${String((err as { stdout?: unknown }).stdout ?? "")}\n${String(
                (err as { stderr?: unknown }).stderr ?? "",
              )}`
            : String(err);
        return {
          passed: false,
          detail: `\`${command}\` failed: ${tail(output)}`,
        };
      }
    }
    return {
      passed: true,
      detail: `all commands passed: ${this.commands.join(", ")}`,
    };
  }
}
