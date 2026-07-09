# bandleader — agent brief

Local-first multi-provider AI agent workbench. It orchestrates the OFFICIAL provider CLIs (`claude`, `codex`) as subprocesses on the user's own subscription logins, and routes tasks to a model tier by difficulty (router lands in S2, UI in S3).

## Hard constraints (never violate)

- **Never call the Anthropic API with plan credentials and never extract OAuth tokens.** The only compliant subscription path is spawning the official `claude` binary. Never use `--bare`.
- Adapters strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the spawned env so runs bill the subscription, never an API key.
- v1 is plans-only: no metered spending anywhere in the app.
- No AI attribution on commits, issues, or PRs.

## Layout

- `src/lib/adapters/` — the adapter layer. `types.ts` (NormalizedEvent union + Adapter interface), `claude.ts`, `codex.ts`. Pure parser functions are separated from spawning code so they are testable without a CLI.
- `src/lib/adapters/__fixtures__/` — real captured CLI output (NDJSON/JSONL) used by the parser tests.
- `src/lib/router/` — the difficulty router. `router.ts` (the layered pipeline: override → rules → classifier → dispatch/failover → verifier-gated escalation), `rules.ts`, `classifier.ts` (Haiku via the Claude adapter, strict JSON rubric), `memory.ts` (sticky failure memory), `decision-log.ts` (append-only JSONL), `verifier.ts` (shell-command ground truth), `config.ts` (tier map validation, plans-only enforced), `testing.ts` (fake adapters for tests only).
- `bandleader.config.ts` — the user-editable tier map + routing thresholds. Verify model strings against the real CLIs before changing them.
- `data/` — gitignored router runtime data (`decisions.jsonl`, `failure-memory.json`).
- `scripts/smoke.ts` — live adapter smoke: `npm run smoke -- <provider> [prompt]`.
- `scripts/smoke-router.ts` — live router smoke: `npm run smoke:router`.
- `src/app/` — Next.js App Router. Placeholder until S3 builds the UI.

## Router invariants

- Transparency: every RouteResult carries the chosen model and a one-line reason. Never route silently.
- Overrides are absolute: a pinned model is never failed over or escalated.
- Escalation is verifier-gated, max one hop, sticky (recorded in failure memory), and never downgrades mid-task.
- The classifier fails safe: parse failure or confidence < 0.6 defaults to mid.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- Tests: Vitest, colocated `*.test.ts` under `src/`. Run `npm run lint && npm run typecheck && npm test` before any PR.
- Adapters stay dependency-light: node `child_process` + `readline`, no provider SDK packages.
- Project baseline rules from `~/.claude/rules/project-baseline.md` apply.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
