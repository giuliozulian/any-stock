import { config as loadDotenv } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Mirrors Next.js's own env file precedence: `.env.local` wins, `.env` fills
// in anything missing. dotenv never overwrites a var already set.
loadDotenv({ path: '.env.local' })
loadDotenv()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
