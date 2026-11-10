# Cloud saves with Supabase

ATELIER keeps working on this PC without any of this. Cloud saves add login and a private online copy of each design.

## Set up

1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon / publishable** key.
4. Create a file named `.env` in this folder:

   ```
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   ```

5. Build and start the app with that file, in Command Prompt:

   ```
   npx vite build
   set PORT=4300
   node --env-file=.env build/index.js
   ```

   In PowerShell, replace the `set` line with `$env:PORT=4300`.

6. Open `http://localhost:4300/`. A **Cloud designs** panel appears above your projects.

Under **Authentication > URL Configuration**, set the Site URL to `http://localhost:4300` so confirmation emails return to the app.

## Keep it safe

- **Never use the `service_role` or secret key here.** It bypasses all privacy rules. Only the anon or publishable key belongs in `.env`.
- The anon key is visible to the browser by design. Privacy comes from the row-level security rules in `schema.sql`, so always run that file.
- `.env` is ignored by git. Do not commit it.

## How saving behaves

- Designs still save to this browser automatically. **Save to cloud** in the editor is a separate, explicit action.
- If the cloud copy changed on another device, the app stops and asks before replacing it.
- **Download** never replaces a plan on this device. A plan already here arrives as a separate "(Cloud copy)".
- Each design can be up to 20 MB, including uploaded images. Your Supabase plan limits may be lower.
- Thumbnails and version history stay on the device where they were made.
