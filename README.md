# bandleader

A local-first workbench for AI coding agents. The bandleader decides which model takes the solo. Each task gets dispatched to the right provider and model for its difficulty, on your existing subscription plans, with the routing decision always visible and always overridable.

## Architecture

Bandleader never calls provider APIs with subscription credentials. It orchestrates the official provider CLIs as subprocesses, on your own logged-in sessions.

```
task
  │
  ▼
adapter layer: run(opts) → AsyncIterable<NormalizedEvent>
  ├─ claude adapter → spawns `claude -p` (Claude Code, your Claude plan login)
  └─ codex adapter  → spawns `codex exec` (Codex CLI, your ChatGPT plan login)
```

This shape is deliberate. Anthropic only permits subscription usage through the official Claude Code binary, so bandleader spawns `claude` as a subprocess and parses its stream. It never extracts OAuth tokens and never talks to the Anthropic API with plan credentials. OpenAI explicitly endorses running Codex on a ChatGPT plan login from third-party harnesses, and the `codex` CLI is used the same way for symmetry. Both adapters normalize their provider's stream into one shared event format.

## Status

S1: adapter layer only. Two working adapters (Claude, Codex) with fixture-tested parsers and a smoke script. No router and no UI yet.

## Setup

Requirements:

- Node 22
- [Claude Code](https://code.claude.com) installed and logged in with your Claude plan (`claude` on PATH)
- [Codex CLI](https://developers.openai.com/codex/cli) installed and logged in with your ChatGPT plan (`codex` on PATH, check with `codex login status`)

```bash
git clone https://github.com/micke-berg/bandleader.git
cd bandleader
npm install
```

Run the checks:

```bash
npm run lint
npm run typecheck
npm test
```

Smoke-test an adapter against your real login (uses a small amount of plan quota):

```bash
npm run smoke -- claude
npm run smoke -- codex
```

No environment variables are needed. The adapters intentionally strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the spawned environment so a stray API key can never be billed instead of the plan.

## Roadmap

- **S2, router**: difficulty routing (user override, hard rules, cheap classifier), plans-only tier map, decision log, verifier-gated escalation
- **S3, UI**: the dashboard and chat lane. Live streams, model badges with routing reasons, session list with resume, telemetry
- **S4, hardening**: QA sweep and baseline checklist

## License

MIT
