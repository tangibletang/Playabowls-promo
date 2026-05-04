/** Hash field used for codes created before campaign tagging existed. */
export const ADMIN_ORIGINAL_BUCKET = '__original__'

export type CouponRecordPersisted = {
  redeemed: boolean
  redeemedAt?: string
  campaign?: string
}

const STORED_CAMPAIGN_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

/** Maps a persisted record into a stable admin grouping key (lowercase slug or original bucket). */
export function campaignBucket(record: CouponRecordPersisted): string {
  const c = record.campaign?.trim().toLowerCase()
  if (c && STORED_CAMPAIGN_SLUG_RE.test(c)) return c
  return ADMIN_ORIGINAL_BUCKET
}

const CLI_CAMPAIGN_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

export function assertCliCampaignSlug(raw: string, cmdLabel?: string): string {
  const c = raw.trim().toLowerCase()
  if (!CLI_CAMPAIGN_SLUG_RE.test(c)) {
    const p = cmdLabel ? `${cmdLabel}: ` : ''
    console.error(
      `${p}invalid slug "${raw}". Use 1–64 chars: lowercase letters, digits, hyphen, underscore (e.g. acme-shop).`
    )
    process.exit(1)
  }
  return c
}

export function isPlayaCampaignBucket(bucket: string): boolean {
  return bucket === ADMIN_ORIGINAL_BUCKET
}

export function isScoopsCampaignBucket(bucket: string): boolean {
  const s = bucket.trim().toLowerCase()
  return s === 'scoops' || s.startsWith('scoops-')
}

/** Human-readable label for admin UI (don't expose raw sentinel keys). */
export function formatCampaignHeading(bucket: string): string {
  if (bucket === ADMIN_ORIGINAL_BUCKET) return 'Playa Bowls · original batch'

  const slug = bucket.toLowerCase()
  if (slug === 'scoops' || slug.startsWith('scoops-')) {
    const tail = slug === 'scoops' ? '' : slug.slice('scoops-'.length).trim()
    const subtitle = tail ? tail.replace(/-/g, ' ') : ''
    return subtitle ? `Scoops · ${subtitle}` : 'Scoops'
  }
  return slug.replace(/-/g, ' ')
}
