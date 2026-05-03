# Cursor Handoff — Playa Bowls Promo

## What this project is

A coupon redemption web app + printable PDF generator for a Dartmouth college class project.
Playa Bowls is giving out 300 physical QR-code coupons worth $2 off. Students scan a QR →
confirm once on their phone at the register → cashier sees a confirmation screen.

**Owner:** Alex (alextang2763@gmail.com), Dartmouth student, new to Node.js.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) |
| Hosting | Vercel |
| Database | Vercel KV (Redis) |
| Language | TypeScript |
| Scripts | `tsx` (run locally, not on Vercel) |
| PDF generation | `pdf-lib` + `qrcode` npm packages |

---

## Current state

**Code is 100% written.** Nothing has been deployed yet.
Alex has a Vercel account but has not run `vercel login` or `vercel link` yet.
`npm install` has been run — `node_modules/` exists.
`.env.local` does NOT exist yet (needs to be created from `.env.local.example`).

---

## File map

```
app/
  layout.tsx             root layout, sets viewport meta for mobile
  globals.css            all styles — no Tailwind, CSS custom properties only
  page.tsx               landing page (just says "scan your QR code")
  redeem/page.tsx        THE MAIN PAGE — full redemption flow, client component
  admin/page.tsx         password-protected dashboard, client component
  api/
    redeem/route.ts      GET = check code status, POST = consume code
    admin/route.ts       POST with password → returns stats JSON

scripts/
  generate-codes.ts      run once: generates 300 codes → Vercel KV + codes.csv
  generate-pdf.ts        run locally: codes.csv + coupon-bg.png → coupons.pdf

.env.local.example       template for environment variables
README.md                full step-by-step deployment guide
```

---

## Data model

All 300 codes live in a single Redis hash in Vercel KV:

```
HSET codes  <8-char-code>  '{"redeemed": false}'
HSET codes  <8-char-code>  '{"redeemed": true, "redeemedAt": "2026-05-03T..."}'
```

Codes are 8 characters, uppercase alphanumeric, no ambiguous chars (no I/O/0/1).

---

## Redemption page flow (`/redeem?code=XYZ`)

State machine in `app/redeem/page.tsx`:

1. **loading** — fetches `GET /api/redeem?code=XYZ`
2. Branches to:
   - **invalid** — code not in KV
   - **already_redeemed** — shows when it was used
   - **pending** — shows "Apply $2 off?" + warning + Confirm button
3. On Confirm → `POST /api/redeem` with `{ code }`
4. **success** — shows "$2 off", "Show this to your cashier!", live clock updating every second

The live clock is cosmetic (the real anti-fraud is single-use codes).

---

## Environment variables

```bash
# Vercel KV credentials — get from Vercel dashboard → Storage → KV → .env.local tab
KV_REST_API_URL=
KV_REST_API_TOKEN=

# Admin page password
ADMIN_PASSWORD=

# Your deployed Vercel URL (no trailing slash) — needed by generate-pdf.ts for QR URLs
NEXT_PUBLIC_SITE_URL=https://your-project.vercel.app
```

These need to be set in TWO places:
1. `.env.local` (for local scripts like `npm run generate-codes`)
2. Vercel dashboard (for the deployed app) — or via `vercel env add <NAME>`

---

## What still needs to happen (in order)

### 1. Install Vercel CLI + log in (Alex does this manually)
```bash
sudo npm install -g vercel
vercel login
cd ~/Desktop/Playabowls-promo && vercel link
```
`vercel link` prompts: create new project, name it `playabowls-promo`, code in `./`

### 2. Create Vercel KV database
Vercel dashboard → project → Storage → Create Database → KV
Connect it to the project. Copy the credentials from the `.env.local` tab in the KV dashboard.

### 3. Set environment variables
```bash
cp .env.local.example .env.local
# fill in .env.local with KV creds + ADMIN_PASSWORD

# Also push to Vercel:
vercel env add KV_REST_API_URL
vercel env add KV_REST_API_TOKEN
vercel env add ADMIN_PASSWORD
vercel env add NEXT_PUBLIC_SITE_URL   # set AFTER first deploy, use the real URL
```

### 4. First deploy
```bash
vercel --prod
# note the URL, e.g. https://playabowls-promo.vercel.app
# update NEXT_PUBLIC_SITE_URL in .env.local and on Vercel
```

### 5. Generate codes (run once)
```bash
npm run generate-codes
# writes 300 codes to KV + outputs codes.csv
```
⚠️ Only run once. Re-running overwrites existing codes.

### 6. Generate PDF (run locally, after getting coupon design image)
```bash
# Place coupon background image at: ~/Desktop/Playabowls-promo/coupon-bg.png
# (JPG also works)
npm run generate-pdf
# outputs coupons.pdf — 300 coupons, 8 per page, US Letter, with cut lines
```

To adjust QR code position on the coupon, edit these constants at the top of `scripts/generate-pdf.ts`:
```ts
const QR_X    = 176   // points from left edge of each coupon (72pt = 1 inch)
const QR_Y    = 20    // points from bottom edge of each coupon
const QR_SIZE = 80    // QR code square size in points
```
Each coupon cell is 270pt wide × 180pt tall (3.75" × 2.5").

---

## npm scripts

```bash
npm run dev            # local dev server at localhost:3000
npm run build          # production build (Vercel runs this automatically)
npm run generate-codes # one-time: populate KV + write codes.csv
npm run generate-pdf   # local: read codes.csv + coupon-bg.png → coupons.pdf
```

---

## Design notes

- Colors: `--pink: #FF6B9D`, `--orange: #FF8C42`, `--teal: #00B4D8`
- All styles in `app/globals.css` using CSS custom properties — no framework
- Mobile-first, large tap targets, designed for phone screens
- No Playa Bowls logo (intentional — class project)

---

## Known issues / things to watch

- `generate-codes.ts` uses `dotenv/config` to load `.env.local` — this must exist before running
- The `@vercel/kv` import in API routes uses the default `kv` singleton which reads `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically when deployed on Vercel
- `generate-codes.ts` uses `createClient()` explicitly (needed for local script context)
- `hgetall` in the admin route returns all 300 codes at once — fine for 300, would need pagination at scale
