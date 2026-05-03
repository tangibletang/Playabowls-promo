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
 * Requires: .env.local with KV_REST_API_URL and KV_REST_API_TOKEN
 */

import 'dotenv/config'
import { createClient } from '@vercel/kv'
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
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN
  if (!kvUrl || !kvToken) {
    console.error('❌  Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local')
    process.exit(1)
  }

  const kv = createClient({ url: kvUrl, token: kvToken })

  console.log(`Generating ${CODE_COUNT} unique codes…`)
  const codes = generateUniqueCodes(CODE_COUNT)

  // Build the hash fields object: { CODE: JSON }
  const fields: Record<string, string> = {}
  for (const code of codes) {
    fields[code] = JSON.stringify({ redeemed: false })
  }

  console.log('Saving to Vercel KV…')
  await kv.hset('codes', fields)
  console.log(`✅  ${CODE_COUNT} codes saved to KV hash "codes"`)

  // Write CSV
  const header = 'code,url,redeemed'
  const rows = codes.map(c => `${c},${SITE_URL}/redeem?code=${c},false`)
  fs.writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n', 'utf8')
  console.log(`✅  codes.csv written to ${CSV_PATH}`)
  console.log(`\n🔗  Example URL: ${SITE_URL}/redeem?code=${codes[0]}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
