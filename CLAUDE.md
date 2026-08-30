@AGENTS.md

# UI components

- Always build UI out of the primitives in `components/ui/` (`Button`, `Input`, `Field`, `Label`, `Checkbox`, `Alert`, `Badge`, `Tabs`, `Select`, `Textarea`, `Tooltip`, `Vault`, etc.). Do not drop down to raw `<button>`, `<input>`, `<label>` when an equivalent already exists there — add a variant or prop to the shared component instead of styling a one-off element inline.
- The whole app uses a single dark "Organic" theme (no light mode toggle exists yet): warm dark surfaces, pill-shaped controls, orange primary/accent. The tokens live in `app/globals.css` (`--background`, `--card`, `--primary`, `--accent`, `--success`, `--destructive`, `--border`, `--secondary`, `--muted`, `--ring`, `--surface`, `--surface-elevated`). Never hardcode hex colors in components — use the CSS variables (via Tailwind classes like `bg-primary`, `text-muted-foreground`, `border-border`) so a future palette change stays a one-file edit.
- Three font families are wired as Tailwind utilities: `font-heading` (Caprasimo — page titles, primary/outline CTA buttons), `font-sans` (Figtree — default body/UI text), `font-mono` (JetBrains Mono — small labels, badges, sync-status text). `Button`'s `default` and `outline` variants already apply `font-heading`; other variants stay `font-sans`.
- If a needed pattern doesn't exist yet in `components/ui/`, extend the existing component (new `variant`/`size` in its `cva` config) rather than forking it, so every consumer benefits and the design stays in one place.

# Architecture

- Next.js App Router only, on Next.js 16 — this version renamed `middleware.ts` to `proxy.ts` and made several other breaking changes from what most training data assumes. Before touching routing, caching, or config, check `node_modules/next/dist/docs/` for the current API (see `AGENTS.md`).
- Auth is Supabase (`@supabase/ssr`), split by runtime:
  - `lib/supabase/client.ts` — browser client, for Client Components only.
  - `lib/supabase/server.ts` — server client (reads/writes cookies via `next/headers`), for Server Components, Server Actions, and Route Handlers.
  - `lib/supabase/middleware.ts` + `proxy.ts` — refreshes the session on every request and does the optimistic redirect between public/protected routes. Public routes are listed in `PUBLIC_ROUTES` in `lib/supabase/middleware.ts`.
- Mutations (sign in/up/out, and future data writes) go through Server Actions (`"use server"`), colocated as `actions.ts` next to the page that uses them (see `app/login/actions.ts`), driven from the client with `useActionState`. Prefer this over client-side `fetch` to an API route.
- Auth is email/password only — no OAuth providers (Google, etc.) are wired up, and none should be added unless explicitly requested. `app/auth/callback/route.ts` still exists for exchanging the code from Supabase's e-mail confirmation links (signup confirmation), not for OAuth.
- New protected areas of the app go under routes added to the protected side of `proxy.ts`'s route check; new public marketing/auth pages go in `PUBLIC_ROUTES`.
- Screens/pages use `framer-motion` for entrance and transition animations (already a dependency) — fade/slide the page or card in on mount, stagger hero/list children, and cross-fade state changes like the sign-in/sign-up toggle (see `app/login/login-form.tsx` and `app/page.tsx`). Server Components that need animation wrap just the animated part in a small client component (see `components/ui/fade-in.tsx`) rather than converting the whole page to a Client Component.

# Security rules

- Never import `lib/supabase/server.ts` (or anything using the service role key, if one is ever added) into a Client Component — server-only Supabase clients and secrets must not reach the browser bundle.
- `proxy.ts` is an optimistic check only (cookie presence), not the source of truth. Every Server Action and Route Handler that reads or mutates user data must independently verify the session via the server Supabase client — do not assume proxy already gatekept the request.
- Only `NEXT_PUBLIC_*` env vars may be referenced from Client Components. Any future secret (service role key, third-party API key) goes unprefixed and is only read in server-only files (Server Actions, Route Handlers, Server Components).
- Let `@supabase/ssr` manage the session cookies as-is (httpOnly, secure defaults) — don't hand-roll cookie parsing/writing for auth state.
- Validate and trim all form input server-side inside the Server Action itself (see the password-length check in `app/login/actions.ts`), even when the `<input>` already has client-side constraints like `required`/`minLength` — those are UX only, not security.
- Return generic error messages for auth failures (e.g. "E-mail ou senha incorretos.") — never leak whether an email exists in the system.
- Treat anything rendered from user-provided or third-party data (note content, file names, OAuth profile fields) as untrusted text, not markup.
