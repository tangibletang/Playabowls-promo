import { getRedis } from '@/lib/redis'
import { NextRequest, NextResponse } from 'next/server'

interface CodeRecord {
  redeemed: boolean
  redeemedAt?: string
}

// GET /api/redeem?code=XYZ — check status without consuming
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code || !/^[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: 'invalid' }, { status: 404 })
  }

  const redis = await getRedis()
  const raw = await redis.hGet('codes', code)
  if (raw === null || raw === undefined) {
    return NextResponse.json({ error: 'invalid' }, { status: 404 })
  }

  const record: CodeRecord = typeof raw === 'string' ? JSON.parse(raw) : raw
  return NextResponse.json(record)
}

// POST /api/redeem — consume a valid code (idempotent if race condition)
export async function POST(req: NextRequest) {
  let code: string
  try {
    const body = await req.json() as { code?: unknown }
    code = String(body.code ?? '').toUpperCase()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: 'invalid' }, { status: 404 })
  }

  const redis = await getRedis()
  const raw = await redis.hGet('codes', code)
  if (raw === null || raw === undefined) {
    return NextResponse.json({ error: 'invalid' }, { status: 404 })
  }

  const record: CodeRecord = typeof raw === 'string' ? JSON.parse(raw) : raw

  if (record.redeemed) {
    return NextResponse.json(
      { error: 'already_redeemed', redeemedAt: record.redeemedAt },
      { status: 409 }
    )
  }

  const redeemedAt = new Date().toISOString()
  const updated: CodeRecord = { redeemed: true, redeemedAt }
  await redis.hSet('codes', code, JSON.stringify(updated))

  return NextResponse.json({ success: true, redeemedAt })
}
