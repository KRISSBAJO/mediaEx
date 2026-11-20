import { proxyMedia } from '@/lib/backend'

// served by the MediaEX API service; see backend/admin.mts (site admins only)
export { proxyMedia as GET, proxyMedia as POST, proxyMedia as DELETE }
