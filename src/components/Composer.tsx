"use client";

import { useState } from "react";

import { createTask } from "@/lib/client/api";
import type { StatusView } from "@/lib/client/api";
import type { ModelRef, RouteOverride } from "@/lib/router";
import type { ProjectEntry } from "@/lib/status/projects";
import type { TaskRecord } from "@/lib/tasks/types";

export const COMPOSER_INPUT_ID = "composer-input";

/** Encode the override select's value; "" means let the router decide. */
export function parseOverrideValue(value: string): RouteOverride | undefined {
  if (value === "") return undefined;
  if (value.startsWith("tier:")) {
    const tier = value.slice(5);
    if (tier === "cheap" || tier === "mid" || tier === "frontier") return { tier };
    return undefined;
  }
  if (value.startsWith("model:")) {
    const [provider, ...rest] = value.slice(6).split("/");
    if ((provider === "claude" || provider === "codex") && rest.length > 0) {
      return { provider, model: rest.join("/") };
    }
  }
  return undefined;
}

export function overrideOptionValue(ref: ModelRef): string {
  return `model:${ref.provider}/${ref.model}`;
}

export function Composer({
  projects,
  status,
  onCreated,
}: {
  projects: ProjectEntry[];
  status: StatusView | undefined;
  onCreated: (task: TaskRecord) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [override, setOverride] = useState("");
  const [allowEdits, setAllowEdits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { task } = await createTask({
        prompt: trimmed,
        kind: "task",
        cwd: cwd === "" ? undefined : cwd,
        override: parseOverrideValue(override),
        permissionProfile: allowEdits ? "workspace-write" : "read-only",
      });
      setPrompt("");
      onCreated(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel composer" aria-label="New task">
      {error !== undefined && <div className="error-banner">{error}</div>}
      <textarea
        id={COMPOSER_INPUT_ID}
        className="textarea"
        placeholder="Describe the task… the bandleader picks who takes the solo"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
      />
      <div className="composer-row">
        <label className="field">
          <span className="field-label">Project</span>
          <select className="select" value={cwd} onChange={(e) => setCwd(e.target.value)}>
            <option value="">none (no repo context)</option>
            {projects.map((project) => (
              <option key={project.path} value={project.path}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <select
            className="select"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            title="Overrides are absolute — a pinned model is never rerouted"
          >
            <option value="">auto — router decides</option>
            <option value="tier:cheap">tier · cheap</option>
            <option value="tier:mid">tier · mid</option>
            <option value="tier:frontier">tier · frontier</option>
            {(status?.overrideOptions ?? []).map((ref) => (
              <option key={overrideOptionValue(ref)} value={overrideOptionValue(ref)}>
                pin · {ref.provider}/{ref.model}
              </option>
            ))}
          </select>
        </label>
        <label className="field" title="Read-only lets the agent inspect the project but not write to it">
          <span className="field-label">Edits</span>
          <select
            className="select"
            value={allowEdits ? "write" : "read"}
            onChange={(e) => setAllowEdits(e.target.value === "write")}
          >
            <option value="read">read-only</option>
            <option value="write">allow edits</option>
          </select>
        </label>
        <div className="spacer" />
        <span className="composer-hint">
          <span className="kbd">⌘↵</span> to dispatch
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy || prompt.trim() === ""}
        >
          {busy ? <span className="spin" aria-hidden /> : null}
          Dispatch
        </button>
      </div>
    </section>
  );
}
