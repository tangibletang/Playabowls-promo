import {
  ADMIN_ORIGINAL_BUCKET,
  CouponRecordPersisted,
  campaignBucket,
  formatCampaignHeading,
} from '@/lib/coupon-record'
import { DEMO_CAMPAIGN } from '@/lib/demo-batch'
import { applyPortfolioPresentation } from '@/lib/portfolio-stats'
import { getRedis } from '@/lib/redis'
import { NextRequest, NextResponse } from 'next/server'

const CODE_PARAM_RE = /^[A-Z0-9]{8}$/

type CampaignTotals = {
  total: number
  redeemed: number
  remaining: number
}

type RedeemedRow = {
  code: string
  redeemedAt: string
  campaignBucket: string
  campaignHeading: string
}

type DashboardPayload = {
  total: number
  redeemed: number
  remaining: number
  redeemedCodes: RedeemedRow[]
  campaigns: Record<string, CampaignTotals & { heading: string }>
  demoMode: boolean
}

async function buildDashboard(redis: Awaited<ReturnType<typeof getRedis>>, demoMode: boolean): Promise<DashboardPayload> {
  const allCodes = await redis.hGetAll('codes')
  if (!allCodes) {
    return {
      total: 0,
      redeemed: 0,
      remaining: 0,
      redeemedCodes: [],
      campaigns: {},
      demoMode,
    }
  }

  const entries = Object.entries(allCodes)
  const redeemed: RedeemedRow[] = []
  const byCampaign = new Map<string, CampaignTotals>()

  function bump(bucket: string, isRedeemed: boolean): void {
    const cur = byCampaign.get(bucket) ?? { total: 0, redeemed: 0, remaining: 0 }
    cur.total += 1
    if (isRedeemed) cur.redeemed += 1
    else cur.remaining += 1
    byCampaign.set(bucket, cur)
  }

  for (const [code, raw] of entries) {
    const record: CouponRecordPersisted = typeof raw === 'string' ? JSON.parse(raw) : raw
    const bucket = campaignBucket(record)
    const redeemedHere = !!(record.redeemed && record.redeemedAt)
    bump(bucket, redeemedHere)

    if (record.redeemed && record.redeemedAt) {
      redeemed.push({
        code,
        redeemedAt: record.redeemedAt,
        campaignBucket: bucket,
        campaignHeading: formatCampaignHeading(bucket),
      })
    }
  }

  redeemed.sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt))

  const campaigns: Record<string, CampaignTotals & { heading: string }> = {}
  const bucketOrder = Array.from(byCampaign.keys()).sort((a, b) => {
    if (a === ADMIN_ORIGINAL_BUCKET) return -1
    if (b === ADMIN_ORIGINAL_BUCKET) return 1
    return a.localeCompare(b)
  })

  for (const key of bucketOrder) {
    const totals = byCampaign.get(key)!
    campaigns[key] = { ...totals, heading: formatCampaignHeading(key) }
  }

  const redeemedCount = redeemed.length
  return {
    total: entries.length,
    redeemed: redeemedCount,
    remaining: entries.length - redeemedCount,
    redeemedCodes: redeemed,
    campaigns,
    demoMode,
  }
}

export async function POST(req: NextRequest) {
  let password: string
  let resetCodeRaw: unknown
  try {
    const body = await req.json() as { password?: unknown; resetCode?: unknown }
    password = String(body.password ?? '')
    resetCodeRaw = body.resetCode
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const submitted = password.trim()
  const adminPassword = process.env.ADMIN_PASSWORD?.trim()
  // No ADMIN_PASSWORD configured → public demo mode (dashboard open, resets limited to the "demo" campaign).
  const demoMode = !adminPassword
  if (!demoMode && submitted !== adminPassword) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const redis = await getRedis()

  const wantsReset =
    typeof resetCodeRaw === 'string' && resetCodeRaw.trim().length > 0 ? resetCodeRaw : null

  if (wantsReset !== null) {
    const code = wantsReset.trim().toUpperCase()
    if (!CODE_PARAM_RE.test(code)) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    const rawExisting = await redis.hGet('codes', code)
    if (rawExisting === null || rawExisting === undefined) {
      return NextResponse.json({ error: 'unknown_code' }, { status: 404 })
    }

    const existing: CouponRecordPersisted =
      typeof rawExisting === 'string' ? JSON.parse(rawExisting) : rawExisting

    if (demoMode && campaignBucket(existing) !== DEMO_CAMPAIGN) {
      return NextResponse.json({ error: 'demo_restricted' }, { status: 403 })
    }

    if (!existing.redeemed) {
      return NextResponse.json({ error: 'not_redeemed' }, { status: 409 })
    }

    const cleared: CouponRecordPersisted = {
      redeemed: false,
      ...(existing.campaign ? { campaign: existing.campaign } : {}),
    }
    await redis.hSet('codes', code, JSON.stringify(cleared))
  }

  const payload = await buildDashboard(redis, demoMode)
  return NextResponse.json(applyPortfolioPresentation(payload))
}
