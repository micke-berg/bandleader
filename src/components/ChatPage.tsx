"use client";

import { useEffect, useRef, useState } from "react";

import { createTask, getStatus, listTasks, openTaskStream } from "@/lib/client/api";
import type { StatusView } from "@/lib/client/api";
import type { TaskRecord } from "@/lib/tasks/types";
import { ModelBadge, StatusBadge } from "./badges";
import { overrideOptionValue, parseOverrideValue } from "./Composer";

const CHAT_INPUT_ID = "chat-input";

/**
 * The chat lane: quick questions through the same pipeline as tasks
 * (`kind: "chat"` — the router skips verification by design). Same badge
 * and override, calmer surface. Messages are independent quick questions;
 * the v1 router routes per task and does not thread sessions.
 */
export function ChatPage() {
  const [entries, setEntries] = useState<TaskRecord[]>();
  const [streamed, setStreamed] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusView>();
  const [prompt, setPrompt] = useState("");
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string>();
  const cleanups = useRef<Array<() => void>>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listTasks()
      .then(({ tasks }) =>
        setEntries(tasks.filter((t) => t.kind === "chat").reverse()),
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    getStatus().then(setStatus).catch(() => undefined);
    const list = cleanups.current;
    return () => list.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries, streamed]);

  const follow = (task: TaskRecord): void => {
    const close = openTaskStream(
      task.id,
      (event) => {
        if (event.type === "task") {
          setEntries((current) =>
            current?.map((t) => (t.id === event.task.id ? event.task : t)),
          );
        } else if (
          event.event.type === "provider_event" &&
          event.event.event.type === "text_delta"
        ) {
          const text = event.event.event.text;
          setStreamed((current) => ({
            ...current,
            [task.id]: (current[task.id] ?? "") + text,
          }));
        }
      },
      () => undefined,
    );
    cleanups.current.push(close);
  };

  const send = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (trimmed === "") return;
    setError(undefined);
    setPrompt("");
    try {
      const { task } = await createTask({
        prompt: trimmed,
        kind: "chat",
        override: parseOverrideValue(override),
      });
      setEntries((current) => [...(current ?? []), task]);
      follow(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPrompt(trimmed);
    }
  };

  const answerFor = (task: TaskRecord): string | undefined => {
    if (task.status === "failed")
      return task.result?.resultText ?? task.error ?? "failed";
    return task.result?.resultText ?? streamed[task.id];
  };

  return (
    <main className="chat-shell">
      <div className="page-head">
        <div>
          <h1 className="page-title">Chat lane</h1>
          <p className="page-sub">
            Quick questions, same routing, no repo context. Each message routes on its own.
          </p>
        </div>
      </div>

      {error !== undefined && <div className="error-banner">{error}</div>}

      <div className="chat-thread">
        {entries === undefined ? (
          <div className="empty-state">loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            Nothing yet. Ask something small — quick questions route cheap by rule.
          </div>
        ) : (
          entries.map((task) => {
            const answer = answerFor(task);
            const provider = task.result?.finalProvider ?? task.decision?.provider;
            const model = task.result?.finalModel ?? task.decision?.model;
            const reason = task.result?.reason ?? task.decision?.reason;
            return (
              <div key={task.id}>
                <div className="chat-q">{task.prompt}</div>
                <div className="panel chat-a" style={{ marginTop: 8 }}>
                  <div className="chat-a-head">
                    <ModelBadge provider={provider} model={model} title={reason} />
                    {reason !== undefined && (
                      <span className="routing-reason" title={reason} style={{ minWidth: 0 }}>
                        {reason}
                      </span>
                    )}
                    {task.status !== "done" && <StatusBadge status={task.status} />}
                  </div>
                  <div className="chat-a-body" data-status={task.status}>
                    {answer !== undefined && answer !== "" ? answer : "…"}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-composer">
        <textarea
          id={CHAT_INPUT_ID}
          className="textarea"
          placeholder="Quick question… (Enter to send, Shift+Enter for a new line)"
          value={prompt}
          rows={2}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <select
          className="select"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          aria-label="Model override"
          title="Overrides are absolute — a pinned model is never rerouted"
        >
          <option value="">auto</option>
          {(status?.overrideOptions ?? []).map((ref) => (
            <option key={overrideOptionValue(ref)} value={overrideOptionValue(ref)}>
              {ref.provider}/{ref.model}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void send()}
          disabled={prompt.trim() === ""}
        >
          Send
        </button>
      </div>
    </main>
  );
}
