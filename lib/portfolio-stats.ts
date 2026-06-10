import { ADMIN_ORIGINAL_BUCKET } from '@/lib/coupon-record'
import { DEMO_CAMPAIGN } from '@/lib/demo-batch'

type CampaignTotals = {
  total: number
  redeemed: number
  remaining: number
  heading: string
}

type RedeemedRow = {
  code: string
  redeemedAt: string
  campaignBucket: string
  campaignHeading: string
}

export type DashboardPayload = {
  total: number
  redeemed: number
  remaining: number
  redeemedCodes: RedeemedRow[]
  campaigns: Record<string, CampaignTotals>
  demoMode: boolean
}

const PORTFOLIO_TOTAL = 600
const PORTFOLIO_REDEEMED = 153

const PORTFOLIO_CAMPAIGNS: Record<string, CampaignTotals> = {
  [ADMIN_ORIGINAL_BUCKET]: {
    heading: 'Playa Bowls · original batch',
    total: 400,
    redeemed: 103,
    remaining: 297,
  },
  scoops: {
    heading: 'Scoops',
    total: 200,
    redeemed: 54,
    remaining: 146,
  },
}

/** Sample rows for the redeemed table — stats above reflect the full 153. */
const SAMPLE_REDEMPTIONS: RedeemedRow[] = [
  { code: 'XJU5NPWE', redeemedAt: '2026-05-20T16:48:51.438Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'JHV228JU', redeemedAt: '2026-05-18T21:48:53.407Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'UMR5B7E4', redeemedAt: '2026-05-17T23:07:56.108Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'JJ3UT2K9', redeemedAt: '2026-05-16T18:22:11.204Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'P4WN8R3Q', redeemedAt: '2026-05-15T14:05:33.891Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'H9K2M7TX', redeemedAt: '2026-05-14T12:31:44.552Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'B5C8N2WP', redeemedAt: '2026-05-12T19:44:02.118Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'R7D4K9MN', redeemedAt: '2026-05-10T11:18:27.663Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'T2H6P8VQ', redeemedAt: '2026-05-08T16:52:09.337Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'M3F9L5XR', redeemedAt: '2026-05-06T13:27:55.774Z', campaignBucket: ADMIN_ORIGINAL_BUCKET, campaignHeading: 'Playa Bowls · original batch' },
  { code: 'S8C4N2WK', redeemedAt: '2026-05-19T15:33:18.229Z', campaignBucket: 'scoops', campaignHeading: 'Scoops' },
  { code: 'D6P9M3HL', redeemedAt: '2026-05-14T20:11:42.885Z', campaignBucket: 'scoops', campaignHeading: 'Scoops' },
  { code: 'F2R7K8TN', redeemedAt: '2026-05-11T17:45:06.441Z', campaignBucket: 'scoops', campaignHeading: 'Scoops' },
  { code: 'G5W3N9PQ', redeemedAt: '2026-05-07T22:08:33.992Z', campaignBucket: 'scoops', campaignHeading: 'Scoops' },
  { code: 'L8H4M2VC', redeemedAt: '2026-05-04T10:56:21.558Z', campaignBucket: 'scoops', campaignHeading: 'Scoops' },
]

/** Replace live Redis totals with portfolio headline numbers; keep real demo-batch redemptions. */
export function applyPortfolioPresentation(payload: DashboardPayload): DashboardPayload {
  if (!payload.demoMode) return payload

  const demoRedemptions = payload.redeemedCodes.filter(r => r.campaignBucket === DEMO_CAMPAIGN)

  return {
    ...payload,
    total: PORTFOLIO_TOTAL,
    redeemed: PORTFOLIO_REDEEMED,
    remaining: PORTFOLIO_TOTAL - PORTFOLIO_REDEEMED,
    campaigns: { ...PORTFOLIO_CAMPAIGNS },
    redeemedCodes: [...SAMPLE_REDEMPTIONS, ...demoRedemptions],
    demoMode: true,
  }
}
