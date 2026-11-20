import { proxyMedia } from '@/lib/backend'

// served by the MediaEX API service; see backend/media/billing.mts (provider webhooks arrive here too)
export { proxyMedia as GET, proxyMedia as POST }
