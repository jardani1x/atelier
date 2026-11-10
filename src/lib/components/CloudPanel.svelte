<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { t } from '$lib/i18n';
  import { CloudError, type CloudProject } from '$lib/services/cloudStore';
  import { storageErrorMessage } from '$lib/services/datastore';
  import { CloudAuthError, cloudConfigured, cloudErrorKeys, cloudStore, cloudUser, initCloud, signIn, signOut, signUp } from '$lib/stores/cloud';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  let projects = $state<CloudProject[]>([]);
  let confirmingDelete = $state<string | null>(null);

  onMount(() => { void initCloud(); });

  const userId = $derived($cloudUser?.id ?? null);
  $effect(() => {
    if (userId) void run(refresh);
    else projects = [];
  });

  function describe(cause: unknown): string {
    if (cause instanceof CloudError) return $t(cloudErrorKeys[cause.code]);
    if (cause instanceof CloudAuthError) return cause.credentials ? $t('cloud.errorCredentials') : cause.message;
    return storageErrorMessage(cause);
  }

  async function run(action: () => Promise<void>) {
    busy = true; error = null; notice = null;
    try { await action(); }
    catch (cause) { error = describe(cause); }
    finally { busy = false; }
  }

  async function refresh() { projects = await cloudStore.list(); }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void run(async () => { await signIn(email.trim(), password); password = ''; });
  }

  function createAccount() {
    void run(async () => {
      const signedIn = await signUp(email.trim(), password);
      password = '';
      if (!signedIn) notice = $t('cloud.checkEmail');
    });
  }

  function download(id: string) {
    void run(async () => {
      const project = await cloudStore.download(id);
      await goto(`${base}/editor?id=${encodeURIComponent(project.id)}`);
    });
  }

  function remove(id: string) {
    void run(async () => {
      confirmingDelete = null;
      await cloudStore.remove(id);
      await refresh();
    });
  }
</script>

{#if cloudConfigured}
  <section aria-label={$t('cloud.title')} class="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
    <h2 class="font-semibold text-gray-800">{$t('cloud.title')}</h2>
    {#if $cloudUser}
      <div class="mt-1 flex flex-wrap items-center justify-between gap-3">
        <p class="text-gray-500">{$t('cloud.signedInAs', { email: $cloudUser.email })}</p>
        <button class="font-semibold text-blue-600 underline disabled:opacity-50" disabled={busy} onclick={() => run(signOut)}>{$t('cloud.signOut')}</button>
      </div>
      {#if projects.length === 0}
        <p class="mt-3 text-gray-500">{$t('cloud.empty')}</p>
      {:else}
        <ul class="mt-3 divide-y divide-gray-100">
          {#each projects as project (project.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 py-2">
              <span class="min-w-0 truncate">{project.name} <span class="text-gray-400">{new Date(project.updatedAt).toLocaleString()}</span></span>
              <span class="flex gap-4">
                <button class="font-semibold text-blue-600 underline disabled:opacity-50" disabled={busy} onclick={() => download(project.id)}>{$t('cloud.download')}</button>
                {#if confirmingDelete === project.id}
                  <button class="font-semibold text-red-700 underline disabled:opacity-50" disabled={busy} onclick={() => remove(project.id)}>{$t('cloud.confirmDelete')}</button>
                  <button class="underline" onclick={() => confirmingDelete = null}>{$t('saveControls.cancel')}</button>
                {:else}
                  <button class="underline disabled:opacity-50" disabled={busy} onclick={() => confirmingDelete = project.id}>{$t('cloud.delete')}</button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="mt-1 text-gray-500">{$t('cloud.intro')}</p>
      <form onsubmit={submit} class="mt-3 flex flex-wrap items-end gap-3">
        <label class="text-xs font-semibold">{$t('cloud.email')}
          <input type="email" required autocomplete="email" bind:value={email} class="mt-1 block w-56 rounded border border-gray-300 px-2 py-1 text-sm font-normal" />
        </label>
        <label class="text-xs font-semibold">{$t('cloud.password')}
          <input type="password" required autocomplete="current-password" bind:value={password} class="mt-1 block w-48 rounded border border-gray-300 px-2 py-1 text-sm font-normal" />
        </label>
        <button type="submit" disabled={busy} class="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">{$t('cloud.signIn')}</button>
        <button type="button" disabled={busy || !email || !password} onclick={createAccount} class="font-semibold text-blue-600 underline disabled:opacity-50">{$t('cloud.createAccount')}</button>
      </form>
    {/if}
    {#if notice}<p role="status" class="mt-3 text-gray-600">{notice}</p>{/if}
    {#if error}<p role="alert" class="mt-3 text-red-800">{error}</p>{/if}
  </section>
{/if}
