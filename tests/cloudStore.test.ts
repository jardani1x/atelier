import { beforeEach, describe, expect, it } from 'vitest';
import { CloudError, createCloudStore, MAX_CLOUD_PROJECT_BYTES, type CloudBackend, type RevisionMemory } from '$lib/services/cloudStore';
import { ProjectConflictError } from '$lib/services/datastore';
import { createDefaultProject } from '$lib/stores/project';
import type { Project } from '$lib/models/types';

function setup(user: string | null = 'user-a') {
  const rows = new Map<string, { data: string; name: string; revision: number }>();
  const session = { user };
  const backend: CloudBackend = {
    userId: async () => session.user,
    list: async () => [...rows].map(([id, row]) => ({ id, name: row.name, updatedAt: '2026-01-01T00:00:00Z', revision: row.revision })),
    read: async id => rows.get(id) ?? null,
    revision: async id => rows.get(id)?.revision ?? null,
    insert: async (_owner, id, content) => {
      if (rows.has(id)) return false;
      rows.set(id, { ...content, revision: 1 });
      return true;
    },
    update: async (id, expected, content) => {
      if (rows.get(id)?.revision !== expected) return false;
      rows.set(id, { ...content, revision: expected + 1 });
      return true;
    },
    remove: async id => { rows.delete(id); },
  };
  const stored = new Map<string, string>();
  const memory: RevisionMemory = {
    get: key => stored.get(key) ?? null,
    set: (key, value) => { stored.set(key, value); },
    remove: key => { stored.delete(key); },
  };
  const local = {
    plans: new Map<string, Project>(),
    refuseSave: false,
    has: async (id: string) => local.plans.has(id),
    save: async (project: Project) => {
      if (local.refuseSave) throw new ProjectConflictError();
      local.plans.set(project.id, project);
    },
    saveCopy: async (project: Project, suffix = 'Recovered copy') => {
      const copy = { ...project, id: `copy-of-${project.id}`, name: `${project.name} (${suffix})` };
      local.plans.set(copy.id, copy);
      return copy;
    },
  };
  return { rows, session, stored, local, store: createCloudStore(backend, local, memory), backend };
}

const code = (promise: Promise<unknown>) => promise.then(() => 'no error', (error: CloudError) => error.code);

describe('cloud saves', () => {
  let project: Project;
  beforeEach(() => { project = createDefaultProject('Home'); });

  it('creates a row, then advances its revision on each save', async () => {
    const { store, rows } = setup();
    await store.save(project);
    expect(rows.get(project.id)?.revision).toBe(1);
    await store.save({ ...project, name: 'Home 2' });
    expect(rows.get(project.id)).toMatchObject({ revision: 2, name: 'Home 2' });
  });

  it('refuses to replace a newer cloud version until forced', async () => {
    const { store, rows, backend, local } = setup();
    await store.save(project);
    const otherDevice = createCloudStore(backend, local, { get: () => null, set: () => {}, remove: () => {} });
    expect(await code(otherDevice.save({ ...project, name: 'Stale' }))).toBe('conflict');
    expect(rows.get(project.id)?.name).toBe('Home');
    await otherDevice.save({ ...project, name: 'Chosen' }, true);
    expect(rows.get(project.id)).toMatchObject({ revision: 2, name: 'Chosen' });
    expect(await code(store.save({ ...project, name: 'Now stale' }))).toBe('conflict');
  });

  it('reports a conflict when the cloud row was deleted, and force recreates it', async () => {
    const { store, rows } = setup();
    await store.save(project);
    rows.delete(project.id);
    expect(await code(store.save(project))).toBe('conflict');
    await store.save(project, true);
    expect(rows.get(project.id)?.revision).toBe(1);
  });

  it('requires a signed-in account', async () => {
    const { store, rows } = setup(null);
    expect(await code(store.save(project))).toBe('signedOut');
    expect(rows.size).toBe(0);
  });

  it('keeps revisions separate per account', async () => {
    const { store, session, stored } = setup();
    await store.save(project);
    session.user = 'user-b';
    expect(await code(store.save(project))).toBe('conflict');
    expect([...stored.keys()]).toEqual([`atelier_cloud_revision:user-a:${project.id}`]);
  });

  it('rejects a design above the size limit before uploading', async () => {
    const { store, rows } = setup();
    expect(await code(store.save({ ...project, name: 'x'.repeat(MAX_CLOUD_PROJECT_BYTES) }))).toBe('tooLarge');
    expect(rows.size).toBe(0);
  });

  it('downloads a new plan under its own ID and continues the same cloud row', async () => {
    const { store, rows, local, stored } = setup();
    await store.save(project);
    stored.clear();
    const downloaded = await store.download(project.id);
    expect(downloaded.id).toBe(project.id);
    expect(local.plans.has(project.id)).toBe(true);
    await store.save(downloaded);
    expect(rows.get(project.id)?.revision).toBe(2);
  });

  it('never replaces a plan already on this device', async () => {
    const { store, local } = setup();
    await store.save(project);
    const mine = { ...project, name: 'Local edits' };
    local.plans.set(project.id, mine);
    const downloaded = await store.download(project.id);
    expect(downloaded.id).not.toBe(project.id);
    expect(downloaded.name).toBe('Home (Cloud copy)');
    expect(local.plans.get(project.id)).toBe(mine);
  });

  it('downloads as a copy when this tab refuses to recreate a deleted plan', async () => {
    const { store, local } = setup();
    await store.save(project);
    local.refuseSave = true;
    expect((await store.download(project.id)).name).toBe('Home (Cloud copy)');
  });

  it('rejects missing, damaged and mismatched cloud rows', async () => {
    const { store, rows } = setup();
    expect(await code(store.download('nope'))).toBe('gone');
    rows.set('bad', { data: '{not json', name: 'Bad', revision: 1 });
    expect(await code(store.download('bad'))).toBe('invalid');
    rows.set('other', { data: JSON.stringify(project), name: 'Home', revision: 1 });
    expect(await code(store.download('other'))).toBe('invalid');
  });

  it('forgets the revision when a cloud design is deleted', async () => {
    const { store, rows, stored } = setup();
    await store.save(project);
    await store.remove(project.id);
    expect(rows.size).toBe(0);
    expect(stored.size).toBe(0);
  });
});
