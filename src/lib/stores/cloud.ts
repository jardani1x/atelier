import { get, writable } from 'svelte/store';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { base } from '$app/paths';
import { localStore } from '$lib/services/datastore';
import { CloudError, createCloudStore, type CloudBackend, type CloudErrorCode, type CloudStore, type RevisionMemory } from '$lib/services/cloudStore';
import { currentProject } from './project';
import { manualSave } from './saveStatus';

const TABLE = 'atelier_projects';
const url = env.PUBLIC_SUPABASE_URL ?? '';
const publicKey = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Without both values the app stays fully local and shows no cloud controls. */
export const cloudConfigured = Boolean(url && publicKey);

export const cloudUser = writable<{ id: string; email: string } | null>(null);
export type CloudSaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; code: CloudErrorCode | 'local' };
export const cloudSaveState = writable<CloudSaveState>({ status: 'idle' });

export const cloudErrorKeys = {
  conflict: 'cloud.errorConflict',
  tooLarge: 'cloud.errorTooLarge',
  signedOut: 'cloud.errorSignedOut',
  gone: 'cloud.errorGone',
  invalid: 'cloud.errorInvalid',
  failed: 'cloud.errorFailed',
  local: 'cloud.errorLocal',
} as const;

let client: Promise<SupabaseClient> | null = null;
function supabase(): Promise<SupabaseClient> {
  // Loaded on first use so local-only sessions never download the client.
  return client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url, publicKey))
    // A failed chunk load must not be cached, or the cloud stays dead until a reload.
    .catch(error => { client = null; throw error; });
}

function unwrap<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new CloudError('failed', error.message);
  return data;
}

const backend: CloudBackend = {
  async userId() {
    const { data } = await (await supabase()).auth.getSession();
    return data.session?.user.id ?? null;
  },
  async list() {
    const rows = unwrap(await (await supabase()).from(TABLE).select('id,name,updated_at,revision').order('updated_at', { ascending: false }));
    return (rows ?? []).map(row => ({ id: row.id, name: row.name, updatedAt: row.updated_at, revision: row.revision }));
  },
  async read(id) {
    return unwrap(await (await supabase()).from(TABLE).select('data,revision').eq('id', id).maybeSingle());
  },
  async revision(id) {
    return unwrap(await (await supabase()).from(TABLE).select('revision').eq('id', id).maybeSingle())?.revision ?? null;
  },
  async insert(owner, id, content) {
    const { error } = await (await supabase()).from(TABLE).insert({ owner, id, ...content, revision: 1 });
    if (error?.code === '23505') return false;
    if (error) throw new CloudError('failed', error.message);
    return true;
  },
  async update(id, expected, content) {
    const rows = unwrap(await (await supabase()).from(TABLE)
      .update({ ...content, revision: expected + 1, updated_at: new Date().toISOString() })
      .eq('id', id).eq('revision', expected).select('revision'));
    return (rows ?? []).length > 0;
  },
  async remove(id) {
    unwrap(await (await supabase()).from(TABLE).delete().eq('id', id));
  },
};

const memory: RevisionMemory = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

export const cloudStore: CloudStore = createCloudStore(backend, localStore, memory);

let watching = false;
/** Safe to call from every component that shows cloud state. */
export async function initCloud() {
  if (!cloudConfigured || watching || typeof window === 'undefined') return;
  watching = true;
  let auth: SupabaseClient['auth'];
  // Callers do not await this; a failed load is retried on the next call instead of rejecting unhandled.
  try { auth = (await supabase()).auth; }
  catch { watching = false; return; }
  let projectId = get(currentProject)?.id;
  currentProject.subscribe(project => {
    const state = get(cloudSaveState);
    if (state.status === 'saved' || (state.status === 'error' && project?.id !== projectId)) cloudSaveState.set({ status: 'idle' });
    projectId = project?.id;
  });
  auth.onAuthStateChange((_event, session) => {
    cloudUser.set(session ? { id: session.user.id, email: session.user.email ?? '' } : null);
  });
}

/** An account problem reported by the sign-in service, as opposed to a storage or network failure. */
export class CloudAuthError extends Error {
  constructor(message: string, readonly credentials = false) {
    super(message);
    this.name = 'CloudAuthError';
  }
}

async function authClient(): Promise<SupabaseClient['auth']> {
  let loaded: SupabaseClient;
  try { loaded = await supabase(); }
  catch (error) { throw new CloudError('failed', error instanceof Error ? error.message : String(error)); }
  // Attaches the session listener if the first load failed.
  void initCloud();
  return loaded.auth;
}

function authFailure(error: { name?: string; code?: string; message: string }): Error {
  if (error.name === 'AuthRetryableFetchError') return new CloudError('failed', error.message);
  return new CloudAuthError(error.message, error.code === 'invalid_credentials');
}

/** Returns whether the account is signed in straight away; false means a confirmation email was sent. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const auth = await authClient();
  // The confirmation link must return to the app, which may be served under a sub-path.
  const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${base}/` } });
  if (error) throw authFailure(error);
  return data.session !== null;
}

export async function signIn(email: string, password: string) {
  const { error } = await (await authClient()).signInWithPassword({ email, password });
  if (error) throw authFailure(error);
}

export async function signOut() {
  const { error } = await (await authClient()).signOut();
  if (error) throw authFailure(error);
}

/** Saves locally first, so the cloud can never hold a version this device lost. */
export async function saveToCloud(force = false): Promise<void> {
  if (get(cloudSaveState).status === 'saving') return;
  cloudSaveState.set({ status: 'saving' });
  try {
    if (!await manualSave()) { cloudSaveState.set({ status: 'error', code: 'local' }); return; }
    const project = get(currentProject);
    if (!project) { cloudSaveState.set({ status: 'idle' }); return; }
    await cloudStore.save(project, force);
    cloudSaveState.set({ status: 'saved' });
  } catch (error) {
    cloudSaveState.set({ status: 'error', code: error instanceof CloudError ? error.code : 'failed' });
  }
}
