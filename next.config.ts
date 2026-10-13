import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import { assertEditorRegistration } from './scripts/check-editor-registration.mjs'

assertEditorRegistration()

const nextConfig: NextConfig = {
  experimental: { cpus: 1 },
  async headers() {
    return [{ source: '/forms/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }, { key: 'Referrer-Policy', value: 'no-referrer' }] }]
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  // Packages with Cloudflare Workers (workerd) specific code
  // Read more: https://opennext.js.org/cloudflare/howtos/workerd
  serverExternalPackages: ['jose', 'pg-cloudflare'],

  // Your Next.js config here
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
