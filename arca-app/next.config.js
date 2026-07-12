/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    // xlsx/mammoth/pdf-parse are only ever reached via a dynamic
    // `await import(...)` inside a try/catch (see lib/fileHandler.ts), which
    // Next's standalone output tracing does not follow — without this, all
    // three are silently missing from .next/standalone/node_modules, so PDF/
    // DOCX/XLSX text extraction throws (caught, returns '') in every packaged
    // build despite working fine in `next dev`. Found while verifying the
    // xlsx replacement below still works once actually packaged.
    outputFileTracingIncludes: {
      '/api/save': ['./node_modules/xlsx/**', './node_modules/mammoth/**', './node_modules/pdf-parse/**'],
      '/api/upload': ['./node_modules/xlsx/**', './node_modules/mammoth/**', './node_modules/pdf-parse/**'],
    },
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

module.exports = nextConfig
