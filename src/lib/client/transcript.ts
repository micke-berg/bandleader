import type { RouterEvent } from "../router";
import { formatCost, formatTokens } from "./format";

/**
 * Folds the raw RouterEvent stream into renderable transcript items:
 * prose stays prominent, tool calls collapse, pipeline markers (routing,
 * attempts, failover, verification, escalation) become one-line meta
 * rows. Pure function — tested without a browser.
 */

export type TranscriptItem =
  | {
      kind: "meta";
      label: string;
      text: string;
      tone?: "warn" | "crit" | "purple";
    }
  | { kind: "prose"; text: string }
  | { kind: "tool"; name: string; summary: string };

const DETAIL_CAP = 400;

function cap(text: string): string {
  return text.length > DETAIL_CAP ? `${text.slice(0, DETAIL_CAP)}…` : text;
}

export function foldEvents(events: RouterEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];

  const push = (item: TranscriptItem): void => {
    const last = items[items.length - 1];
    if (item.kind === "prose" && last?.kind === "prose") {
      last.text += item.text;
      return;
    }
    items.push(item);
  };

  for (const event of events) {
    switch (event.type) {
      case "decision":
        push({
          kind: "meta",
          label: "routed",
          text: `${event.decision.tier} → ${event.decision.provider}/${event.decision.model} — ${event.decision.reason}`,
        });
        break;
      case "attempt_started":
        push({
          kind: "meta",
          label: "attempt",
          text: `${event.provider}/${event.model} (${event.tier})`,
        });
        break;
      case "failover":
        push({
          kind: "meta",
          label: "failover",
          tone: "warn",
          text: `${event.failover.from.provider}/${event.failover.from.model} → ${event.failover.to.provider}/${event.failover.to.model} — ${cap(event.failover.detail)}`,
        });
        break;
      case "verifying":
        push({ kind: "meta", label: "verifying", text: event.verifier });
        break;
      case "escalated":
        push({
          kind: "meta",
          label: "escalated",
          tone: "purple",
          text: `${event.escalation.fromTier} → ${event.escalation.toTier} after ${event.escalation.verifier} failed — ${cap(event.escalation.detail)}`,
        });
        break;
      case "result":
        break; // rendered as the result block, not a transcript row
      case "provider_event": {
        const inner = event.event;
        switch (inner.type) {
          case "session_started":
            push({
              kind: "meta",
              label: "session",
              text: `${inner.model} · ${inner.sessionId.slice(0, 8)}`,
            });
            break;
          case "text_delta":
            push({ kind: "prose", text: inner.text });
            break;
          case "tool_call":
            push({ kind: "tool", name: inner.name, summary: inner.summary });
            break;
          case "usage":
            push({
              kind: "meta",
              label: "usage",
              text: `in ${formatTokens(inner.inputTokens)} · out ${formatTokens(inner.outputTokens)}${
                inner.costUsd !== undefined
                  ? ` · ${formatCost(inner.costUsd)} plan-equivalent`
                  : ""
              }`,
            });
            break;
          case "rate_limited":
            push({
              kind: "meta",
              label: "rate limited",
              tone: "warn",
              text: cap(inner.detail),
            });
            break;
          case "error":
            push({ kind: "meta", label: "error", tone: "crit", text: cap(inner.detail) });
            break;
          case "plan_window":
            break; // feeds the quota strip, not the transcript
          case "completed":
            break; // the result block covers it
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }
  return items;
}
