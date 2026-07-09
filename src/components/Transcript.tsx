"use client";

import type { RouterEvent } from "@/lib/router";
import { foldEvents } from "@/lib/client/transcript";
import type { TaskRecord } from "@/lib/tasks/types";

/**
 * The streaming transcript: prose prominent, tool calls collapsed, one
 * quiet meta row per pipeline marker. Ends with a result block when the
 * task failed (success prose has already streamed above it).
 */
export function Transcript({
  events,
  task,
}: {
  events: RouterEvent[];
  task: TaskRecord | undefined;
}) {
  const items = foldEvents(events);
  const failed = task?.status === "failed";
  const failureText =
    task?.error ?? (failed ? task?.result?.resultText : undefined);

  return (
    <section className="panel transcript" aria-label="Transcript">
      {items.length === 0 && (
        <div className="transcript-block">
          <div className="transcript-prose" style={{ color: "var(--t-quiet)" }}>
            Waiting for the router…
          </div>
        </div>
      )}
      {items.map((item, index) => {
        if (item.kind === "prose") {
          return (
            <div key={index} className="transcript-block">
              <div className="transcript-prose">{item.text}</div>
            </div>
          );
        }
        if (item.kind === "tool") {
          return (
            <details key={index} className="tool-call">
              <summary>
                <span className="tool-name">{item.name}</span>
                <span className="tool-hint">{item.summary}</span>
              </summary>
              <pre>{item.summary}</pre>
            </details>
          );
        }
        return (
          <div key={index} className="transcript-event" data-tone={item.tone}>
            <span className="ev-type">{item.label}</span>
            <span>{item.text}</span>
          </div>
        );
      })}
      {failed && failureText !== undefined && failureText.trim() !== "" && (
        <div className="transcript-block result-block" data-tone="crit">
          <div className="transcript-prose">{failureText}</div>
        </div>
      )}
    </section>
  );
}
