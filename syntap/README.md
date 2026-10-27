# SynTap

SynTap is a React/Vite digital business card platform backed by Supabase. It includes a public marketing site, administrator sign-in, protected profile management, published profile pages, QR code downloads, NFC URL guidance, and first-party profile view analytics.

Card editors support Light, Dark, and Liquid Glass themes, per-card button appearance and shape, Default or Two-Column button layouts, and an optional six-photo Showcase gallery. The public card keeps location actions with its other contact buttons and opens the saved Google Maps destination (or a search based on the address). Public cover photos are optional and appear only after their image loads successfully. Unfinished editor changes are automatically kept in session storage for the current browser session; uploaded images are stored in the private card-media bucket, while browser storage does not retain administrator credentials.

## Run locally

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**. The anon/publishable key is intended for browser use; never put a service-role key in this project.
3. Run the migrations in order in the Supabase SQL Editor: `supabase/migrations/202610250001_initial_schema.sql`, then `supabase/migrations/202610270001_add_showcase_images.sql`.
4. In Supabase **Authentication → Providers**, disable public sign-ups. In **Authentication → Users**, create the first administrator with a strong password.
5. In the SQL Editor, grant that account the administrator role:

   ```sql
   insert into public.admin_users (user_id)
   select id
   from auth.users
   where email = 'admin@example.com';
   ```

   Replace the email with the account you created. Adding an administrator is an explicit, trusted-operator action; there is no public registration page.
6. Install dependencies and start Vite:

   ```sh
   npm install
   npm run dev
   ```

## Security and data behavior

- Admin pages require both a Supabase session and membership in `public.admin_users`. Database row-level security enforces administrator access to management, analytics, and NFC data.
- Anonymous users can read only published digital cards. Profile media is stored in a private bucket and is signed only when an administrator or a published card is authorized to view it.
- The profile view RPC records only the card, timestamp, and explicit `direct`, `qr`, or `nfc` attribution; it does not store visitor IP addresses or identities.
- QR codes use each published card's actual deployment origin and URL. NFC tags are programmed separately with a compatible device; the site does not claim to write to hardware.
- Configure a single-page-app fallback to `index.html` with the hosting provider so routes such as `/card/alex-santos` work on direct visits.
- Configure Supabase Auth's allowed redirect URLs for the local and production origins before deployment.

## Available commands

- `npm run dev` — local development server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — Oxlint
