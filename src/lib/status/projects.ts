import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Candidate projects for the composer's project picker: sibling
 * directories of this repo (i.e. the developer workspace) that contain a
 * `.git`. Local convenience only — the API also accepts any absolute
 * path typed by hand.
 */

export interface ProjectEntry {
  name: string;
  path: string;
}

const MAX_PROJECTS = 60;

export function listProjects(cwd: string = process.cwd()): ProjectEntry[] {
  const workspace = path.dirname(path.resolve(cwd));
  let entries: string[];
  try {
    entries = readdirSync(workspace);
  } catch {
    return [];
  }
  const projects: ProjectEntry[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(workspace, name);
    try {
      if (!statSync(full).isDirectory()) continue;
      statSync(path.join(full, ".git"));
      projects.push({ name, path: full });
    } catch {
      // not a git project; skip
    }
    if (projects.length >= MAX_PROJECTS) break;
  }
  // This repo itself first, then alphabetical.
  const self = path.resolve(cwd);
  projects.sort((a, b) =>
    a.path === self ? -1 : b.path === self ? 1 : a.name.localeCompare(b.name),
  );
  return projects;
}
