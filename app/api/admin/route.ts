import { kv } from '@vercel/kv'
import { NextRequest, NextResponse } from 'next/server'

interface CodeRecord {
  redeemed: boolean
  redeemedAt?: string
}

export async function POST(req: NextRequest) {
  let password: string
  try {
    const body = await req.json() as { password?: unknown }
    password = String(body.password ?? '')
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword || password !== adminPassword) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const allCodes = await kv.hgetall<Record<string, string>>('codes')
  if (!allCodes) {
    return NextResponse.json({ total: 0, redeemed: 0, remaining: 0, redeemedCodes: [] })
  }

  const entries = Object.entries(allCodes)
  const redeemed: Array<{ code: string; redeemedAt: string }> = []

  for (const [code, raw] of entries) {
    const record: CodeRecord = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (record.redeemed && record.redeemedAt) {
      redeemed.push({ code, redeemedAt: record.redeemedAt })
    }
  }

  redeemed.sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt))

  return NextResponse.json({
    total: entries.length,
    redeemed: redeemed.length,
    remaining: entries.length - redeemed.length,
    redeemedCodes: redeemed,
  })
}
