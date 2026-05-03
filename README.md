# Playa Bowls $2 Off Promo — Setup & Deployment Guide

A coupon redemption system for the Dartmouth Playa Bowls promo.  
Students scan a QR code → confirm once at the register → cashier sees the live timestamp screen.

---

## Step 0 — Install Node.js (5 min)

1. Go to **nodejs.org** and download the **LTS** installer for macOS.
2. Run the `.pkg` installer, click through defaults.
3. Open **Terminal** (Spotlight → "Terminal") and verify:
   ```
   node --version   # should print v20.x.x or higher
   npm --version    # should print 10.x.x or higher
   ```

---

## Step 1 — Install Vercel CLI (2 min)

```bash
npm install -g vercel
```

Log in to your Vercel account:
```bash
vercel login
```
A browser tab will open — click **Continue with GitHub** (or email).

---

## Step 2 — Install project dependencies (1 min)

```bash
cd ~/Desktop/Playabowls-promo
npm install
```

---

## Step 3 — Create a Vercel project + KV database (5 min)

### 3a. Link the folder to Vercel
```bash
vercel link
```
When prompted:
- "Set up and deploy?" → **Y**
- "Which scope?" → pick your account
- "Link to existing project?" → **N** (create new)
- "What's your project name?" → `playabowls-promo` (or anything)
- "In which directory is your code located?" → `.` (just press Enter)

### 3b. Create a KV (Redis) database
1. Go to **vercel.com/dashboard** → your project → **Storage** tab
2. Click **Create Database** → choose **KV**
3. Name it anything (e.g., `playabowls-kv`) → **Create & Continue**
4. Click **Connect to Project** → select your project → **Connect**
5. Go to the **`.env.local`** tab inside the KV dashboard — you'll see the credentials.

---

## Step 4 — Set up environment variables (3 min)

Copy the example file:
```bash
cp .env.local.example .env.local
```

Open `.env.local` in any text editor and fill in:
```
KV_REST_API_URL=   ← paste from the KV dashboard
KV_REST_API_TOKEN= ← paste from the KV dashboard
ADMIN_PASSWORD=    ← make up a password you'll remember
NEXT_PUBLIC_SITE_URL=https://playabowls-promo.vercel.app  ← your Vercel URL (set after first deploy)
```

**Also add these to Vercel** (so the deployed app can read them):
```bash
vercel env add KV_REST_API_URL
# paste the value, press Enter, choose Production + Preview + Development

vercel env add KV_REST_API_TOKEN
vercel env add ADMIN_PASSWORD
vercel env add NEXT_PUBLIC_SITE_URL
```

---

## Step 5 — Deploy to Vercel (2 min)

```bash
vercel --prod
```

After it finishes, you'll see something like:
```
✅  Production: https://playabowls-promo.vercel.app
```

**Update `NEXT_PUBLIC_SITE_URL`** in your `.env.local` with that URL.  
Also update it on Vercel: `vercel env add NEXT_PUBLIC_SITE_URL` (overwrite).

---

## Step 6 — Generate 300 coupon codes (1 min)

```bash
npm run generate-codes
```

This will:
- Create 300 unique codes in your Vercel KV database
- Write `codes.csv` to your project folder (300 redemption URLs)

> ⚠️  Only run this **once**. Running it again will overwrite existing codes.

---

## Step 7 — Generate the print PDF (5–10 min)

### 7a. Add your coupon design
Place your coupon background image in the project root:
```
~/Desktop/Playabowls-promo/coupon-bg.png
```
(JPG also works — the script will find it automatically.)

The image will be stretched to **3.75" × 2.5"** per coupon slot.  
Design at **2:1.33 ratio** for best results (e.g., 1500×1000px).

### 7b. Configure QR position
Open `scripts/generate-pdf.ts` and adjust these three variables at the top:
```ts
const QR_X    = 176   // points from left edge of coupon  (72pt = 1 inch)
const QR_Y    = 20    // points from bottom edge of coupon
const QR_SIZE = 80    // size of QR code square
```
Run once with a small test first, open the PDF, measure, adjust, re-run.

### 7c. Generate
```bash
npm run generate-pdf
```

Output: `coupons.pdf` — **300 coupons**, 8 per page, ~38 pages, with cut lines.

### 7d. Print tips
- Print on **cardstock** (65 lb or heavier)
- **Actual size** / 100% scale (don't "fit to page")
- Guillotine-cut along the gray cut lines

---

## Pages & features

| URL | Description |
|-----|-------------|
| `/` | Landing page |
| `/redeem?code=XXXXXXXX` | Redemption flow (mobile-first) |
| `/admin` | Password-protected dashboard |

### Redemption flow
1. Student scans QR → lands on `/redeem?code=…`
2. Sees confirmation screen with one-time-use warning
3. Taps **Confirm** at the register
4. Success screen shows "$2 off" + live updating clock (proves it's not a screenshot)

### Admin dashboard
Shows total/redeemed/remaining counts, list of redeemed codes with timestamps.  
Password is whatever you set in `ADMIN_PASSWORD`.

---

## Troubleshooting

**"Missing KV credentials" when running generate-codes**  
→ Make sure `.env.local` exists and has `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

**Coupon shows "Invalid coupon" on the live site**  
→ Make sure you ran `npm run generate-codes` *after* deploying (or at least with correct KV creds).

**PDF is huge (>50 MB)**  
→ Compress your background image before using it. Tools: squoosh.app (free, browser-based).

**QR code is in the wrong spot**  
→ Adjust `QR_X` and `QR_Y` in `generate-pdf.ts`.  
Remember: origin is bottom-left of each coupon cell. Increase `QR_Y` to move up, increase `QR_X` to move right.

**Need to redeploy after changes**  
```bash
vercel --prod
```
