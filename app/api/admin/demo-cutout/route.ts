import { DEMO_CAMPAIGN } from '@/lib/demo-batch'
import { generateCouponCutoutPdf } from '@/lib/pdf'
import { getRedis } from '@/lib/redis'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_DESIGN_BYTES = 4 * 1024 * 1024
const CODE_RE = /^[A-Z0-9]{8}$/

function checkPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD?.trim()
  return !adminPassword || password.trim() === adminPassword
}

// POST /api/admin/demo-cutout — render one printer slip (cutout) with QR for a demo code
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  let password = ''
  let code = ''
  let designBytes: Buffer | undefined

  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const form = await req.formData()
  password = String(form.get('password') ?? '')
  code = String(form.get('code') ?? '').trim().toUpperCase()

  const design = form.get('design')
  if (design instanceof File && design.size > 0) {
    if (design.size > MAX_DESIGN_BYTES) {
      return NextResponse.json({ error: 'design_too_large' }, { status: 413 })
    }
    designBytes = Buffer.from(await design.arrayBuffer())
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!CODE_RE.test(code)) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
  }

  const redis = await getRedis()
  const raw = await redis.hGet('codes', code)
  if (raw === null || raw === undefined) {
    return NextResponse.json({ error: 'unknown_code' }, { status: 404 })
  }

  const record = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (record?.campaign !== DEMO_CAMPAIGN) {
    return NextResponse.json({ error: 'not_demo_code' }, { status: 403 })
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`).replace(/\/$/, '')
  const pdfBytes = await generateCouponCutoutPdf({
    code,
    siteUrl,
    backgroundBytes: designBytes,
    redeemPath: '/redeem',
  })

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="coupon-cutout.pdf"',
    },
  })
}
