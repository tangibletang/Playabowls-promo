import { getDemoBatchCodes, regenerateDemoBatch } from '@/lib/demo-batch'
import { generateDemoCouponsPdf } from '@/lib/pdf'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_DESIGN_BYTES = 4 * 1024 * 1024

function checkPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD?.trim()
  return !adminPassword || password.trim() === adminPassword
}

async function parseRequest(req: NextRequest): Promise<{
  password: string
  designBytes?: Buffer
  reuseBatch: boolean
}> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const password = String(form.get('password') ?? '')
    const reuseBatch = String(form.get('reuseBatch') ?? '') === 'true'

    const design = form.get('design')
    if (design instanceof File && design.size > 0) {
      if (design.size > MAX_DESIGN_BYTES) {
        throw new Error('design_too_large')
      }
      const mime = design.type.toLowerCase()
      if (mime && !mime.startsWith('image/')) {
        throw new Error('invalid_design')
      }
      return {
        password,
        designBytes: Buffer.from(await design.arrayBuffer()),
        reuseBatch,
      }
    }

    return { password, reuseBatch }
  }

  try {
    const body = await req.json() as { password?: unknown; reuseBatch?: unknown }
    return {
      password: String(body.password ?? ''),
      reuseBatch: body.reuseBatch === true,
    }
  } catch {
    return { password: '', reuseBatch: false }
  }
}

// POST /api/admin/demo-pdf — generate a coupon batch and return a printable PDF (inline preview)
export async function POST(req: NextRequest) {
  let password = ''
  let designBytes: Buffer | undefined
  let reuseBatch = false

  try {
    const parsed = await parseRequest(req)
    password = parsed.password
    designBytes = parsed.designBytes
    reuseBatch = parsed.reuseBatch
  } catch (err) {
    const key = err instanceof Error ? err.message : 'bad_request'
    if (key === 'design_too_large') {
      return NextResponse.json({ error: 'design_too_large' }, { status: 413 })
    }
    if (key === 'invalid_design') {
      return NextResponse.json({ error: 'invalid_design' }, { status: 400 })
    }
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let codes = reuseBatch ? await getDemoBatchCodes() : []
  if (codes.length === 0) codes = await regenerateDemoBatch()
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? `https://${req.headers.get('host')}`).replace(/\/$/, '')
  const pdfBytes = await generateDemoCouponsPdf({
    codes,
    siteUrl,
    backgroundBytes: designBytes,
    redeemPath: '/redeem',
  })

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="coupons.pdf"',
      'X-Preview-Code': codes[0] ?? '',
    },
  })
}
