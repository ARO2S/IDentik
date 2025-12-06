# Identik

**Tagline:** Trusted identity for trusted media.

Identik helps anyone — especially non-technical and older users — protect their photos with a friendly Identik Name (e.g. `jenny.identik`) and verify whether a photo is authentic. This monorepo houses the full-stack platform across web, mobile, and shared packages.

## Repository Layout

- `web/` – Next.js App Router UI + API routes (name onboarding, sign, verify, Supabase Auth).
- `mobile/` – Expo React Native client (login, protect, check flows share the same APIs).
- `packages/`
  - `api-client/` – Shared HTTP client (future work).
  - `crypto-utils/` – Canonical payload helpers + Ed25519 signing/verifying utilities.
  - `database/` – Drizzle schema, migrations, Supabase helpers, and seed scripts.
  - `reputation/` – Domain reputation scoring engine invoked by the APIs.

## Brand assets

All production-ready artwork lives in `web/public/assets/` and is mirrored into the running Next.js app without extra build steps. Use the categories below to pick the right files for marketing pages, favicons, and partner integrations:

- **Wordmarks and logotypes** – `identik_logo_horizontal.(png|svg)`, `identik_logo_horizontal_mobile.(png|svg)`, `identik_logo_horizontal_compact.(png|svg)` for hero headlines, navigation bars, and mobile headers.
- **Tagline & hero lockups** – `identik_logo_tagline_600x320.(png|svg)`, `identik_logo_tagline_1000x500.(png|svg)`, and `identik_logo_splash_1000x500.(png|svg)` for billboard moments, case studies, and hero illustrations.
- **Shield + icon set** – `identik_icon_shield_{64,128,256}.(png|svg)` plus the illustrative `IdentikShieldFilled.png` / `IdentikShieldOutline.png` for app chrome, avatars, and onboarding callouts.
- **Favicons & install surfaces** – `favicon-16.png`, `favicon-32.png`, `apple-touch-icon-180.svg`, and the `identik_pwa_icon_512png(.svg)` pair that power the browser tab, pinned tabs, and PWA installs.
- **Marketing art** – `IdentikLogo.svg` and `IdentikMotto.png` for press materials or storytelling blocks where you need extra texture.

Expo still relies on the files inside `mobile/assets/` (`icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`). Keep those in sync with the web kit whenever you refresh brand colors or shields.

## Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment variables**

   Copy `.env.example` to `.env` and fill in the required secrets. Essentials:

   - `DATABASE_URL` – Supabase/Postgres connection string (`sslmode=require` strongly recommended).
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` – backend keys.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` – exposed to web/mobile clients for login.
   - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` – mirrored values for the Expo app.
   - `EXPO_PUBLIC_API_URL` – points the Expo client at your running Next.js server (e.g. `http://192.168.1.5:3000`).
   - `DEV_SIGNING_PRIVATE_KEY` / `DEV_SIGNING_PUBLIC_KEY` – dev Ed25519 signer used by `/api/v1/sign`.

   You can also use `.env.local` inside individual workspaces if you need overrides.

3. **Database migrations**

   ```bash
   npm run db:migrate
   ```

4. **Seed demo data** (creates a sample user + Identik Name + signing key)

   ```bash
   npm run db:seed
   ```

5. **Run the web app**

   ```bash
   npm run dev:web
   ```

6. **Run the mobile app (Expo)**

   ```bash
   npm run dev:mobile
   ```

## Database & Supabase configuration

1. Provision a Supabase project (or any Postgres instance).
2. Grab the **connection string** from Supabase → Project Settings → Database → Connection string (use the pooled `aws-...pooler.supabase.com` URI, add `sslmode=require`).
3. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and their `NEXT_PUBLIC_` counterparts.
4. Run migrations + seed (steps above).
5. When deploying, set the same variables anywhere the API routes or Expo client runs.

## Feature Highlights (so far)

- ✅ Drizzle migrations + pooled Supabase helpers (`packages/database`).
- ✅ Canonical payload, signing, EXIF embedding, and verification APIs (`/api/v1/sign`, `/api/v1/verify`).
- ✅ Domain reputation engine + `/api/v1/names/:name/reputation` endpoint.
- ✅ Identik-branded web UI with onboarding, protect, and check flows powered by the real APIs.
- ✅ Supabase Auth login/logout for both web and mobile clients.
- ✅ Seed script that provisions a demo user, Identik Name, signing key, and domain events.
- 🔜 Expo UI for protect/check flows (login screen is in progress).

## Tooling

- TypeScript everywhere (strict configs via `tsconfig.base.json`).
- ESLint + Next linting + Expo TypeScript.
- Drizzle ORM for migrations.
- `@noble/ed25519` + `exiftool-vendored` for cryptography + metadata stamping.
- Supabase Auth (email/password) for both web and mobile.

## Next Steps

- Ship the AI reporting workflow end-to-end (verify UI button → API → enforcement).
- Fold signer activity + report ratios into verification scoring + domain reputation.
- Finish the Expo protect/check experiences so mobile mirrors the web app.
- Add automated tests (Vitest/Jest) for crypto helpers, APIs, and scoring math.
- Wire up CI (GitHub Actions) for lint/test/build and abuse alerting hooks.
- Let creators pick watermark defaults per Identik Name and auto-generate both original + watermarked downloads post-protect.
