import type { Project } from '$lib/models/types';
import { readProject } from '$lib/utils/projectValidation';
import { ProjectConflictError, type DataStore } from './datastore';

/** Matches the check constraint in supabase/schema.sql. */
export const MAX_CLOUD_PROJECT_BYTES = 20 * 1024 * 1024;

export type CloudErrorCode = 'conflict' | 'tooLarge' | 'signedOut' | 'gone' | 'invalid' | 'failed';

export class CloudError extends Error {
  constructor(readonly code: CloudErrorCode, message: string = code) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface CloudProject { id: string; name: string; updatedAt: string; revision: number }
export interface CloudContent { name: string; data: string }

export interface CloudBackend {
  userId(): Promise<string | null>;
  list(): Promise<CloudProject[]>;
  read(id: string): Promise<{ data: string; revision: number } | null>;
  revision(id: string): Promise<number | null>;
  /** False when the row already exists. */
  insert(owner: string, id: string, content: CloudContent): Promise<boolean>;
  /** False when the row is missing or no longer at the expected revision. */
  update(id: string, expected: number, content: CloudContent): Promise<boolean>;
  remove(id: string): Promise<void>;
}

export interface RevisionMemory {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

type LocalLibrary = Pick<DataStore, 'has' | 'save' | 'saveCopy'>;

/** The cloud is a second copy: only explicit saves write to it, and only a stale-checked revision can replace a row. */
export function createCloudStore(backend: CloudBackend, local: LocalLibrary, memory: RevisionMemory) {
  const key = (owner: string, id: string) => `atelier_cloud_revision:${owner}:${id}`;

  async function owner(): Promise<string> {
    const id = await backend.userId();
    if (!id) throw new CloudError('signedOut');
    return id;
  }

  function known(user: string, id: string): number | null {
    const stored = Number.parseInt(memory.get(key(user, id)) ?? '', 10);
    return Number.isInteger(stored) && stored > 0 ? stored : null;
  }

  return {
    list: () => backend.list(),

    /** With `force`, replaces whatever the cloud holds; callers offer that only after a conflict. */
    async save(project: Project, force = false): Promise<void> {
      const user = await owner();
      const data = JSON.stringify(project);
      if (new Blob([data]).size > MAX_CLOUD_PROJECT_BYTES) throw new CloudError('tooLarge');
      const content = { name: project.name || 'Untitled Project', data };
      const expected = force ? await backend.revision(project.id) : known(user, project.id);
      const written = expected === null
        ? await backend.insert(user, project.id, content)
        : await backend.update(project.id, expected, content);
      if (!written) throw new CloudError('conflict');
      memory.set(key(user, project.id), String((expected ?? 0) + 1));
    },

    /** Never replaces a local plan: a plan already on this device arrives as a separate copy. */
    async download(id: string): Promise<Project> {
      const user = await owner();
      const row = await backend.read(id);
      if (!row) throw new CloudError('gone');
      let project: Project;
      try {
        project = readProject(JSON.parse(row.data));
      } catch {
        throw new CloudError('invalid');
      }
      if (project.id !== id) throw new CloudError('invalid');
      if (!await local.has(id)) {
        try {
          await local.save(project);
          memory.set(key(user, id), String(row.revision));
          return project;
        } catch (error) {
          // This tab remembers a deleted plan under that ID, so the store refuses to recreate it.
          if (!(error instanceof ProjectConflictError)) throw error;
        }
      }
      return local.saveCopy(project, 'Cloud copy');
    },

    async remove(id: string): Promise<void> {
      const user = await owner();
      await backend.remove(id);
      memory.remove(key(user, id));
    },
  };
}

export type CloudStore = ReturnType<typeof createCloudStore>;
