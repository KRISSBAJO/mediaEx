import { proxyMedia } from '@/lib/backend'

// served by the MediaEX API service; see backend/media/routes.mts
export { proxyMedia as GET, proxyMedia as HEAD, proxyMedia as POST, proxyMedia as PUT, proxyMedia as PATCH, proxyMedia as DELETE }
