/**
 * generate-codes.ts
 *
 * Run with:  npm run generate-codes -- --campaign your-slug
 *
 * What it does:
 *   1. Generates COUNT unique 8-char alphanumeric codes (default 300) that are not
 *      already keys in Redis hash `codes`.
 *   2. Merges them into Redis alongside any existing batches (another company’s promo).
 *   3. Writes codes-{slug}.csv with columns: code, url, redeemed.
 *
 * Requires REDIS_URL (Vercel Redis) + NEXT_PUBLIC_SITE_URL in .env.development.local
 * (`vercel env pull .env.development.local --environment=production`) or .env.local
 */

import './load-env'
import { createClient } from 'redis'
import * as fs from 'fs'
import * as path from 'path'

import { assertCliCampaignSlug } from '../lib/coupon-record'

// ── Defaults ───────────────────────────────────────────────────────
const DEFAULT_COUNT = 300
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 to avoid confusion
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://your-project.vercel.app').replace(/\/$/, '')
const REDIS_HASH = 'codes'
// ─────────────────────────────────────────────────────────────────

function parseArgs(): { campaign: string; count: number } {
  const argv = process.argv.slice(2)
  let campaign = ''
  let count = DEFAULT_COUNT
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--campaign' || a === '-c') {
      campaign = argv[++i] ?? ''
      continue
    }
    if ((a === '--count' || a === '-n') && argv[i + 1]) {
      const parsed = Number.parseInt(argv[++i], 10)
      if (Number.isFinite(parsed) && parsed > 0) count = parsed
      continue
    }
    if ((a.startsWith('--campaign=') || a.startsWith('-c=')) && !campaign) {
      campaign = a.split('=')[1] ?? ''
    }
  }
  if (!campaign.trim()) {
    console.error(
      '❌  Missing --campaign <slug>. Example:\n    npm run generate-codes -- --campaign acme-downtown'
    )
    process.exit(1)
  }
  return { campaign: assertCliCampaignSlug(campaign, 'generate-codes'), count }
}

function generateCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

function generateUniqueCodes(count: number, occupied: ReadonlySet<string>): string[] {
  const used = new Set<string>(occupied)
  const codes: string[] = []
  while (codes.length < count) {
    const c = generateCode()
    if (used.has(c)) continue
    used.add(c)
    codes.push(c)
  }
  return codes
}

async function main() {
  const { campaign, count } = parseArgs()
  const url = process.env.REDIS_URL
  if (!url) {
    console.error('❌  Missing REDIS_URL. Run vercel env pull or copy from Vercel → Env.')
    process.exit(1)
  }

  const redis = createClient({ url })
  await redis.connect()

  try {
    const existingKeys = await redis.hKeys(REDIS_HASH)
    const occupied = new Set(existingKeys.map(k => String(k)))
    console.log(`${occupied.size.toLocaleString()} code(s) already in Redis "${REDIS_HASH}"`)

    console.log(`Generating ${count} new unique codes (${campaign})…`)
    const codes = generateUniqueCodes(count, occupied)

    // Build hash fields object: { CODE: JSON }
    const fields: Record<string, string> = {}
    for (const code of codes) {
      fields[code] = JSON.stringify({ redeemed: false, campaign })
    }

    console.log(`Saving merged batch to Redis (${campaign})…`)
    await redis.hSet(REDIS_HASH, fields)
    console.log(`✅  Saved ${codes.length} new fields in "${REDIS_HASH}" (campaign tag: "${campaign}")`)

    const CSV_PATH = path.join(process.cwd(), `codes-${campaign}.csv`)
    const header = 'code,url,redeemed,campaign'
    const rows = codes.map(c =>
      `${c},${SITE_URL}/redeem?code=${c},false,${campaign}`
    )
    fs.writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n', 'utf8')
    console.log(`✅  ${CSV_PATH}`)
    console.log(`\n🔗  Example URL: ${SITE_URL}/redeem?code=${codes[0]}`)
  } finally {
    await redis.quit().catch(() => {})
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
