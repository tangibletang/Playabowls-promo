import { createClient } from 'redis'

let client: ReturnType<typeof createClient> | undefined

export async function getRedis() {
  if (client?.isOpen) {
    return client
  }
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error(
      'Missing REDIS_URL. Connect Vercel Redis (Storage) or set REDIS_URL in the environment.'
    )
  }
  client = createClient({ url })
  client.on('error', err => console.error('Redis:', err))
  await client.connect()
  return client
}
