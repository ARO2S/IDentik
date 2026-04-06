# Neon + Better Auth Migration Design

**Date:** 2026-04-06
**Approach:** Big bang — single branch, all changes coordinated

## Summary

Migrate IDentik off Supabase entirely. Replace the Supabase-hosted Postgres with Neon (serverless Postgres), and replace Supabase Auth with Better Auth (Drizzle adapter, email+password provider). Deployment target is Vercel. No existing user data to preserve — clean slate on Neon.

---

## Architecture

Four coordinated changes, all in one branch:

1. **Database driver** — swap `pg` + `drizzle-orm/node-postgres` for `@neondatabase/serverless` + `drizzle-orm/neon-serverless`
2. **Schema** — remove custom `users` table, add Better Auth's four managed tables, update FK on `domains.ownerUserId`
3. **Server auth** — replace `supabaseAdmin.auth.getUser()` with Better Auth's `auth.api.getSession()`
4. **Client auth** — replace `@supabase/auth-helpers-react` with Better Auth's React client

All API route business logic, Drizzle queries, reputation/crypto packages, and signing/verification behavior are unchanged.

---

## Data Model

### Tables removed

| Table | Reason |
|---|---|
| `users` | Was a thin auth-sync mirror. Better Auth's `user` table replaces it. |

### Tables added (Better Auth managed)

| Table | Purpose |
|---|---|
| `user` | Auth identity — email, name, emailVerified, timestamps |
| `session` | Active sessions with expiry and Bearer token |
| `account` | Credential storage (email/password provider) |
| `verification` | Email verification tokens |

Better Auth is configured to generate UUIDs for `user.id` so `domains.ownerUserId` remains a `uuid` column with a real FK reference.

### Tables unchanged

`domains`, `domainPublicKeys`, `mediaRecords`, `signatures`, `verificationLogs`, `domainEvents`

### FK change

`domains.ownerUserId` — was `references(() => users.id)`, becomes `references(() => user.id)` (Better Auth's table).

### Migrations

A new Drizzle migration:
- Drops the `users` table
- Adds the four Better Auth tables
- Updates the `domains.ownerUserId` FK

The upsert into `users` in `names/purchase/route.ts` is removed — Better Auth handles user creation at sign-up.

---

## Auth Flow & API Contract

### Sign-in / Sign-up

| Action | Current (Supabase) | Replacement (Better Auth) |
|---|---|---|
| Sign in | `supabaseClient.auth.signInWithPassword({email, password})` | `authClient.signIn.email({email, password})` |
| Sign up | `supabaseClient.auth.signUp({email, password})` | `authClient.signUp.email({email, password, name})` |
| Sign out | `supabaseClient.auth.signOut()` | `authClient.signOut()` |

### Session & Bearer token

Better Auth's `bearer` plugin is enabled on the server instance. This preserves the existing `Authorization: Bearer <token>` contract used by all frontend fetch calls — no changes to `ProtectPhotoForm`, `IdentikNameForm`, or `AuthPanel` fetch logic.

The client retrieves the token via `authClient.getSession()` → `session.data.session.token`, replacing Supabase's `session.access_token`.

### Server-side validation

`web/src/server/auth.ts` is rewritten to use Better Auth:

```ts
import { auth } from '@/server/better-auth';

export const getAuthenticatedUser = async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email };
};
```

The `AuthenticatedUser` interface shape is unchanged. All four API routes call `getAuthenticatedUser` identically — zero changes in the route handlers.

### New files

- **`web/src/server/better-auth.ts`** — Better Auth server instance configured with Drizzle adapter, `emailAndPassword` provider, `bearer` plugin, UUID ID generation
- **`web/src/app/api/auth/[...all]/route.ts`** — Next.js catch-all that delegates to Better Auth's handler

### Files deleted

- `packages/database/src/supabase.ts`
- `web/src/server/supabase.ts`
- `web/src/components/providers/SupabaseProvider.tsx`

---

## Dependencies

### `packages/database`

| Remove | Add |
|---|---|
| `@supabase/supabase-js` | `@neondatabase/serverless` |
| `pg` | `ws` |
| `@types/pg` | `@types/ws` |

### `web`

| Remove | Add |
|---|---|
| `@supabase/auth-helpers-nextjs` | `better-auth` |
| `@supabase/auth-helpers-react` | |

---

## Environment Variables

| Remove | Add |
|---|---|
| `SUPABASE_URL` | `BETTER_AUTH_SECRET` (random 32+ char secret) |
| `SUPABASE_ANON_KEY` | `BETTER_AUTH_URL` (e.g. `https://yourapp.vercel.app`) |
| `SUPABASE_SERVICE_ROLE_KEY` | |
| `SUPABASE_DB_URL` | |
| `DIRECT_DATABASE_URL` | |

`DATABASE_URL` is retained — it points to Neon instead of Supabase.

---

## Mobile App (React Native / Expo)

`mobile/App.tsx` currently uses `@supabase/supabase-js` directly — `createClient`, `auth.signInWithPassword`, `auth.signUp`, `auth.signOut`, `auth.getSession`, `auth.onAuthStateChange`.

Better Auth does not ship a native React Native SDK. The mobile app will call Better Auth's HTTP endpoints directly, store the session token in memory (same as now), and pass it as `Authorization: Bearer <token>` — which the server already supports via the `bearer` plugin.

**Auth endpoint mapping:**

| Action | Current (Supabase) | Replacement (Better Auth REST) |
|---|---|---|
| Sign in | `supabase.auth.signInWithPassword({email, password})` | `POST /api/auth/sign-in/email` |
| Sign up | `supabase.auth.signUp({email, password})` | `POST /api/auth/sign-up/email` |
| Sign out | `supabase.auth.signOut()` | `POST /api/auth/sign-out` |
| Get session | `supabase.auth.getSession()` | `GET /api/auth/get-session` |
| Auth state change | `supabase.auth.onAuthStateChange()` | Removed — polling or app-state based refresh |

The `session.access_token` used for API calls becomes `session.token` from the Better Auth session response.

`mobile/package.json` removes `@supabase/supabase-js` and `react-native-url-polyfill`. The `createClient` import and the `requireSupabase` guard are removed entirely.

---

## Files Changed Summary

| File | Action |
|---|---|
| `packages/database/package.json` | Update dependencies |
| `packages/database/src/index.ts` | Replace Pool/drizzle setup with Neon serverless |
| `packages/database/src/schema.ts` | Remove `users` table, add Better Auth tables, update FK |
| `packages/database/src/env.ts` | Remove Supabase env var getters |
| `packages/database/src/supabase.ts` | Delete |
| `packages/database/drizzle.config.ts` | Update credentials format for Neon |
| `packages/database/migrations/` | New migration: drop users, add Better Auth tables |
| `web/package.json` | Update dependencies |
| `web/src/server/auth.ts` | Replace Supabase auth with Better Auth session check |
| `web/src/server/supabase.ts` | Delete |
| `web/src/server/better-auth.ts` | New — Better Auth server instance |
| `web/src/app/api/auth/[...all]/route.ts` | New — Better Auth Next.js handler |
| `web/src/components/providers/SupabaseProvider.tsx` | Delete |
| `web/src/components/auth/AuthPanel.tsx` | Replace Supabase auth calls with Better Auth client |
| `web/src/components/forms/ProtectPhotoForm.tsx` | Update session token source |
| `web/src/components/forms/IdentikNameForm.tsx` | Update session token source |
| `mobile/package.json` | Remove `@supabase/supabase-js`, `react-native-url-polyfill` |
| `mobile/App.tsx` | Replace Supabase auth calls with Better Auth REST API calls |
