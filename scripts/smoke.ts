/**
 * Live smoke runner: drives a real prompt through an adapter and prints
 * the normalized event stream, one JSON line per event.
 *
 * Usage:
 *   npm run smoke -- <claude|codex> [prompt]
 *   npm run smoke -- <claude|codex> --resume <sessionId> [prompt]
 *
 * Uses your real CLI logins and a small amount of plan quota.
 */
import { getAdapter } from "../src/lib/adapters";

function usage(): never {
  console.error(
    "usage: npm run smoke -- <claude|codex> [--resume <sessionId>] [prompt]",
  );
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const provider = argv.shift();
  if (provider === undefined) usage();

  const adapter = getAdapter(provider);
  if (adapter === undefined) {
    console.error(`unknown provider: ${provider}`);
    usage();
  }

  let resumeSessionId: string | undefined;
  if (argv[0] === "--resume") {
    argv.shift();
    resumeSessionId = argv.shift();
    if (resumeSessionId === undefined) usage();
  }

  const prompt = argv.join(" ") || "Reply with exactly: ok";

  console.error(
    `[smoke] ${adapter.displayName} | prompt: ${JSON.stringify(prompt)}` +
      (resumeSessionId !== undefined ? ` | resume: ${resumeSessionId}` : ""),
  );

  let failed = false;
  for await (const event of adapter.run({ prompt, resumeSessionId })) {
    console.log(JSON.stringify(event));
    if (event.type === "error") failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(`[smoke] fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
