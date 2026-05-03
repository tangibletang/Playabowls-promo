/** Load local env files (tsx scripts don't use Next's env layering). Order: weakest → strongest */
import { config as loadEnv } from 'dotenv'

loadEnv()
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env.development.local', override: true })
