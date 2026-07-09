"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getProjects, getStatus, listTasks } from "@/lib/client/api";
import type { StatusView } from "@/lib/client/api";
import type { ProjectEntry } from "@/lib/status/projects";
import type { TaskRecord } from "@/lib/tasks/types";
import { Composer, COMPOSER_INPUT_ID } from "./Composer";
import { QuotaStrip } from "./QuotaStrip";
import { TaskCard } from "./TaskCard";
import { useNow } from "./useNow";

const TASK_POLL_MS = 2_500;
const STATUS_POLL_MS = 30_000;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}

export function StagePage() {
  const router = useRouter();
  const now = useNow();
  const [tasks, setTasks] = useState<TaskRecord[]>();
  const [status, setStatus] = useState<StatusView>();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [selected, setSelected] = useState(-1);

  const refreshTasks = useCallback(async () => {
    try {
      const { tasks: list } = await listTasks();
      setTasks(list);
    } catch {
      // transient poll failure; keep the last good list
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const { tasks: list } = await listTasks();
        if (!cancelled) setTasks(list);
      } catch {
        // transient poll failure; keep the last good list
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), TASK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const next = await getStatus();
        if (!cancelled) setStatus(next);
      } catch {
        // status is decoration; never block the stage on it
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    getProjects()
      .then(({ projects: list }) => setProjects(list))
      .catch(() => setProjects([]));
  }, []);

  const stageTasks = useMemo(
    () => tasks?.filter((task) => task.kind === "task"),
    [tasks],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        document.getElementById(COMPOSER_INPUT_ID)?.focus();
        return;
      }
      if (event.key === "Escape" && isTypingTarget(event.target)) {
        (event.target as HTMLElement).blur();
        return;
      }
      if (isTypingTarget(event.target)) return;
      const count = stageTasks?.length ?? 0;
      if (count === 0) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => Math.min(i + 1, count - 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter" && selected >= 0) {
        const task = stageTasks?.[selected];
        if (task !== undefined) router.push(`/tasks/${task.id}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stageTasks, selected, router]);

  const running = stageTasks?.filter(
    (t) => t.status !== "done" && t.status !== "failed",
  ).length;

  return (
    <main>
      <div className="page-head">
        <div>
          <h1 className="page-title">The stage</h1>
          <p className="page-sub">
            Dispatch a task; the router picks the model and always tells you why.
          </p>
        </div>
      </div>

      {status !== undefined && <QuotaStrip providers={status.providers} />}

      <Composer
        projects={projects}
        status={status}
        onCreated={() => {
          setSelected(-1);
          void refreshTasks();
        }}
      />

      <div className="list-head">
        <span className="section-label">Tasks</span>
        {stageTasks !== undefined && (
          <span className="count">
            {stageTasks.length} total{running !== undefined && running > 0 ? ` · ${running} live` : ""}
          </span>
        )}
      </div>

      {stageTasks === undefined ? (
        <div className="empty-state">loading…</div>
      ) : stageTasks.length === 0 ? (
        <div className="empty-state">
          No tasks yet. Describe one above and press <span className="kbd">⌘↵</span> — the
          routing decision will be visible on every card.
        </div>
      ) : (
        <div className="task-list">
          {stageTasks.map((task, index) => (
            <TaskCard key={task.id} task={task} now={now} selected={index === selected} />
          ))}
        </div>
      )}

      <div className="footer-hints">
        <span><span className="kbd">/</span> compose</span>
        <span><span className="kbd">j</span><span className="kbd">k</span> select</span>
        <span><span className="kbd">↵</span> open</span>
        <span><span className="kbd">1</span><span className="kbd">2</span><span className="kbd">3</span> screens</span>
      </div>
    </main>
  );
}
