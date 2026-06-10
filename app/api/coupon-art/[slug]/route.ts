import * as fs from 'fs'
import * as path from 'path'
import { NextRequest, NextResponse } from 'next/server'

const ART: Record<string, string> = {
  playa: 'playabowls_coupon_with_qr.png',
  scoops: 'scoops_coupon.png',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const filename = ART[params.slug]
  if (!filename) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const filePath = path.join(process.cwd(), filename)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const bytes = fs.readFileSync(filePath)
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
