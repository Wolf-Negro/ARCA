const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  buildExcludes: [/middleware-manifest\.json$/],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // arca-desktop identifies its own bundled server by this header before
  // trusting a port: Windows can let a wildcard (0.0.0.0) bind and a
  // loopback-only (127.0.0.1) bind coexist on the same port with no error on
  // either side, so "did my process manage to listen()" isn't enough proof
  // that traffic is actually reaching it instead of whatever else is bound.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'X-Arca-App', value: '1' }] },
    ]
  },
}

module.exports = withPWA(nextConfig)
