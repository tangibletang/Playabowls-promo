/**
 * generate-codes.ts
 *
 * Run with:  npm run generate-codes
 *
 * What it does:
 *   1. Generates 300 unique 8-char alphanumeric codes
 *   2. Saves them all to Vercel KV (hash key "codes")
 *   3. Writes codes.csv with columns: code, url, redeemed
 *
 * Requires REDIS_URL (Vercel Redis) + NEXT_PUBLIC_SITE_URL in .env.development.local
 * (`vercel env pull .env.development.local --environment=production`) or .env.local
 */

import './load-env'
import { createClient } from 'redis'
import * as fs from 'fs'
import * as path from 'path'

// ── Config ────────────────────────────────────────────────────────
const CODE_COUNT = 300
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 to avoid confusion
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://your-project.vercel.app').replace(/\/$/, '')
const CSV_PATH = path.join(process.cwd(), 'codes.csv')
// ─────────────────────────────────────────────────────────────────

function generateCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

function generateUniqueCodes(count: number): string[] {
  const set = new Set<string>()
  while (set.size < count) {
    set.add(generateCode())
  }
  return Array.from(set)
}

async function main() {
  const url = process.env.REDIS_URL
  if (!url) {
    console.error('❌  Missing REDIS_URL. Run vercel env pull or copy from Vercel → Env.')
    process.exit(1)
  }

  const redis = createClient({ url })
  await redis.connect()

  try {
    console.log(`Generating ${CODE_COUNT} unique codes…`)
    const codes = generateUniqueCodes(CODE_COUNT)

    // Build the hash fields object: { CODE: JSON }
    const fields: Record<string, string> = {}
    for (const code of codes) {
      fields[code] = JSON.stringify({ redeemed: false })
    }

    console.log('Saving to Redis…')
    await redis.hSet('codes', fields)
    console.log(`✅  ${CODE_COUNT} codes saved to Redis hash "codes"`)

    // Write CSV
    const header = 'code,url,redeemed'
    const rows = codes.map(c => `${c},${SITE_URL}/redeem?code=${c},false`)
    fs.writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n', 'utf8')
    console.log(`✅  codes.csv written to ${CSV_PATH}`)
    console.log(`\n🔗  Example URL: ${SITE_URL}/redeem?code=${codes[0]}`)
  } finally {
    await redis.quit().catch(() => {})
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
