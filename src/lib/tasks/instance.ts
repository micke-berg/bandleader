import config from "../../../bandleader.config";
import { TaskManager } from "./manager";

/**
 * One TaskManager per server process, stashed on globalThis so Next.js
 * dev-mode module reloads reuse the same instance (and its in-flight
 * tasks) instead of orphaning them.
 */

const globalStash = globalThis as typeof globalThis & {
  __bandleaderTaskManager?: TaskManager;
};

export function getTaskManager(): TaskManager {
  globalStash.__bandleaderTaskManager ??= new TaskManager({
    deps: { config },
  });
  return globalStash.__bandleaderTaskManager;
}
