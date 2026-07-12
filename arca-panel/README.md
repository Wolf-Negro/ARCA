# ARCA Panel

Admin panel for issuing and validating agency/team activation codes consumed
by `arca-desktop`'s onboarding flow. See the root `CLAUDE.md` for the full
picture of how this fits with `arca-app` and `arca-desktop`.

## Known limitation: JWT revocation

`/api/activate` signs each agency a JWT (`{ role: 'authenticated', team_id }`)
that Supabase's RLS policies check directly (`auth.jwt() ->> 'team_id'`).
**Deactivating an agency here does not revoke JWTs it already has** — those
tokens remain valid for their full `expiresIn` (180 days) regardless of the
agency's `active` flag in this panel. This is an accepted limitation for the
pilot; a production revocation flow would need either short-lived tokens with
silent refresh, or a Postgres-side check against a "revoked" table joined
into the RLS policy.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
