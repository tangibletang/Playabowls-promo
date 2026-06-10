# Promo Coupon Platform — QR Redemption + Admin Dashboard

A full-stack coupon redemption system built with **Next.js 14 (App Router)**, **Redis**, and **Vercel**.
Originally built for a real campus promo (Playa Bowls + Scoops, $2-off coupons distributed as printed
QR codes to ~600 students), now kept live as a **public, password-free demo**.

**Live demo:** [hanover-coupons.vercel.app](https://hanover-coupons.vercel.app)
**Admin dashboard:** [hanover-coupons.vercel.app/admin](https://hanover-coupons.vercel.app/admin) — open, no login required

---

## What it does

- **Single-use QR coupons.** Each code lives in a Redis hash as `{ redeemed, redeemedAt, campaign }`.
  A student scans a printed QR → lands on `/redeem?code=XXXX` → confirms once → cashier sees a live
  "redeemed at HH:MM:SS" screen. Re-scanning shows "already redeemed."
- **Multi-campaign support.** The same Redis hash and redeem flow serve multiple brands/batches
  (`Playa Bowls`, `Scoops`, and a `demo` batch), distinguished by a `campaign` tag and routed to
  brand-specific copy/colors.
- **Admin dashboard** (`/admin`) — live stats per campaign (total / redeemed / remaining /
  redemption rate), a table of redeemed codes, and a one-click **reset** to un-redeem a code.
- **On-demand demo coupon generator** — from the admin dashboard, click **"Generate Demo Coupons
  (PDF)"** to mint 10 fresh, unique QR codes (tagged `campaign: "demo"`), write them to Redis, and
  download a print-ready, branded PDF — all generated server-side in a single API call
  (`pdf-lib` + `qrcode`, no external services).
- **Print-ready PDF generation scripts** (`scripts/generate-pdf.ts`) for producing full coupon
  sheets (300+ codes, 2×5 per Letter page, calibrated QR placement on the brand artwork).

---

## Demo mode

The deployed `/admin` has **no password** — it's intentionally public for portfolio viewing:

- The historical Playa Bowls / Scoops totals are **read-only**. Reset is restricted to codes in
  the `demo` campaign bucket.
- Click **"Generate Demo Coupons (PDF)"** to create your own batch of 10 QR codes and download the
  PDF. Scan one (or open the `/redeem?code=...` link from the PDF) to walk through the full
  redemption flow, then reset it from the dashboard.

This behavior is controlled by a single environment variable: if `ADMIN_PASSWORD` is **set**,
`/admin` requires a password and full reset access is restored (original production behavior). If
it's **unset**, the dashboard runs in open demo mode as described above.

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript |
| Hosting | Vercel |
| Database | Redis (Vercel Marketplace / any Redis-compatible host) |
| PDF generation | `pdf-lib` + `qrcode`, run both server-side (admin route) and via local scripts |
| Styling | Plain CSS with custom properties — no UI framework |

---

## Architecture

```
app/
  page.tsx               landing page
  redeem/page.tsx         redemption flow (client component, state machine)
  scoops/page.tsx          Scoops-branded redemption variant
  admin/page.tsx           admin dashboard (client component)
  api/
    redeem/route.ts        GET = check code status, POST = consume code
    admin/route.ts          POST = dashboard stats + code reset (demo-mode aware)
    admin/demo-pdf/route.ts POST = generate a fresh demo batch + PDF (Node runtime)

lib/
  redis.ts                Redis client singleton
  coupon-record.ts         shared types + campaign bucket/branding helpers
  pdf.ts                   shared PDF generator used by the demo-pdf route

scripts/
  generate-codes.ts        one-time/per-campaign: generate N codes → Redis + CSV
  generate-pdf.ts           local: codes.csv + brand artwork → print-ready PDF
```

All codes live in a single Redis hash (`codes`), keyed by an 8-character code:

```
HSET codes  <CODE>  '{"redeemed": false, "campaign": "scoops-hanover"}'
HSET codes  <CODE>  '{"redeemed": true, "redeemedAt": "2026-05-03T...", "campaign": "demo"}'
```

---

## Running locally

```bash
npm install
cp .env.local.example .env.local
# fill in REDIS_URL (any Redis instance) and NEXT_PUBLIC_SITE_URL
# leave ADMIN_PASSWORD unset to run /admin in open demo mode locally
npm run dev
```

To generate a one-off batch of codes + a printable PDF for a new campaign:

```bash
npm run generate-codes -- --campaign my-campaign --count 50
PDF_CODES_CSV=./codes-my-campaign.csv npm run generate-pdf
```

---

## Deploying

```bash
vercel link
vercel env add REDIS_URL
vercel env add NEXT_PUBLIC_SITE_URL
# optional — set ADMIN_PASSWORD to lock down /admin instead of running it as an open demo
vercel --prod
```

To switch the live admin dashboard back to open demo mode, remove the env var:

```bash
vercel env rm ADMIN_PASSWORD production
```
