"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createTask, getStatus } from "@/lib/client/api";
import type { ModelRef } from "@/lib/router";
import type { TaskRecord } from "@/lib/tasks/types";

/**
 * The override, one click away: re-run this task's prompt with the model
 * pinned (or back on auto). A pinned model is never failed over or
 * escalated — the router treats it as absolute.
 */
export function RerunMenu({ task }: { task: TaskRecord }) {
  const router = useRouter();
  const [options, setOptions] = useState<ModelRef[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStatus()
      .then((status) => setOptions(status.overrideOptions))
      .catch(() => setOptions([]));
  }, []);

  const rerun = async (value: string): Promise<void> => {
    if (value === "" || busy) return;
    setBusy(true);
    try {
      const [provider, ...rest] = value.split("/");
      const { task: next } = await createTask({
        prompt: task.prompt,
        kind: task.kind,
        cwd: task.cwd,
        permissionProfile: task.permissionProfile,
        override:
          value === "auto"
            ? undefined
            : provider === "claude" || provider === "codex"
              ? { provider, model: rest.join("/") }
              : undefined,
      });
      router.push(`/tasks/${next.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="select"
      value=""
      disabled={busy}
      onChange={(e) => void rerun(e.target.value)}
      aria-label="Re-run this task on a specific model"
      title="Re-run this prompt with the model pinned (overrides are absolute)"
    >
      <option value="">re-run on…</option>
      <option value="auto">auto — router decides</option>
      {options.map((ref) => (
        <option key={`${ref.provider}/${ref.model}`} value={`${ref.provider}/${ref.model}`}>
          pin · {ref.provider}/{ref.model}
        </option>
      ))}
    </select>
  );
}
