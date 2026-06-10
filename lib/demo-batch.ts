import { getRedis } from '@/lib/redis'

export const DEMO_CAMPAIGN = 'demo'
export const DEMO_BATCH_SIZE = 10

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

/** Remove all codes in the ephemeral demo batch from Redis. */
export async function clearDemoBatch(): Promise<number> {
  const redis = await getRedis()
  const all = await redis.hGetAll('codes')
  const toDelete: string[] = []

  for (const [code, raw] of Object.entries(all)) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (record?.campaign === DEMO_CAMPAIGN) toDelete.push(code)
  }

  if (toDelete.length > 0) await redis.hDel('codes', toDelete)
  return toDelete.length
}

/** Replace the demo batch with fresh single-use codes and return them. */
export async function regenerateDemoBatch(count = DEMO_BATCH_SIZE): Promise<string[]> {
  const redis = await getRedis()
  await clearDemoBatch()

  const all = await redis.hGetAll('codes')
  const occupied = new Set(Object.keys(all))
  const codes: string[] = []

  while (codes.length < count) {
    const c = generateCode()
    if (occupied.has(c) || codes.includes(c)) continue
    codes.push(c)
  }

  const fields: Record<string, string> = {}
  for (const code of codes) {
    fields[code] = JSON.stringify({ redeemed: false, campaign: DEMO_CAMPAIGN })
  }
  await redis.hSet('codes', fields)

  return codes
}

/** Return current demo-batch codes from Redis (empty if none). */
export async function getDemoBatchCodes(): Promise<string[]> {
  const redis = await getRedis()
  const all = await redis.hGetAll('codes')
  const codes: string[] = []

  for (const [code, raw] of Object.entries(all)) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (record?.campaign === DEMO_CAMPAIGN) codes.push(code)
  }

  return codes.sort()
}
