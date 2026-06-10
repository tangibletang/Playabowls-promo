import { generateDemoCouponsPdf } from '@/lib/pdf'
import { getRedis } from '@/lib/redis'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 to avoid confusion
const DEMO_CAMPAIGN = 'demo'
const DEMO_COUNT = 10

function generateCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

// POST /api/admin/demo-pdf — (re)generate the "demo" campaign batch and return a printable PDF
export async function POST(req: NextRequest) {
  let password = ''
  try {
    const body = await req.json() as { password?: unknown }
    password = String(body.password ?? '')
  } catch {
    // no body is fine — only required when ADMIN_PASSWORD is set
  }

  const adminPassword = process.env.ADMIN_PASSWORD?.trim()
  if (adminPassword && password.trim() !== adminPassword) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const redis = await getRedis()

  // Replace any previous demo batch so repeated clicks don't pile up codes.
  const all = await redis.hGetAll('codes')
  const toDelete: string[] = []
  for (const [code, raw] of Object.entries(all)) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (record?.campaign === DEMO_CAMPAIGN) toDelete.push(code)
  }
  if (toDelete.length > 0) await redis.hDel('codes', toDelete)

  const occupied = new Set(Object.keys(all).filter(k => !toDelete.includes(k)))
  const codes: string[] = []
  while (codes.length < DEMO_COUNT) {
    const c = generateCode()
    if (occupied.has(c) || codes.includes(c)) continue
    codes.push(c)
  }

  const fields: Record<string, string> = {}
  for (const code of codes) {
    fields[code] = JSON.stringify({ redeemed: false, campaign: DEMO_CAMPAIGN })
  }
  await redis.hSet('codes', fields)

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`).replace(/\/$/, '')
  const pdfBytes = await generateDemoCouponsPdf(codes, siteUrl)

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="demo-coupons.pdf"',
    },
  })
}
