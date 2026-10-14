import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      APP_TIMEZONE: string
      TEST_MIGRATIONS: D1Migration[]
    }
    interface GlobalProps {
      mainModule: typeof import('../src/index')
    }
  }
}
