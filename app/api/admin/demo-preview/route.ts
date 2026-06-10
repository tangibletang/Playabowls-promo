import { regenerateDemoBatch } from '@/lib/demo-batch'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// POST /api/admin/demo-preview — mint a demo batch and return a code for the redemption UI
export async function POST(req: NextRequest) {
  let password = ''
  try {
    const body = await req.json() as { password?: unknown }
    password = String(body.password ?? '')
  } catch {
    // empty body is fine when no admin password is set
  }

  const adminPassword = process.env.ADMIN_PASSWORD?.trim()
  if (adminPassword && password.trim() !== adminPassword) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const codes = await regenerateDemoBatch()
  return NextResponse.json({ previewCode: codes[0], codes })
}
