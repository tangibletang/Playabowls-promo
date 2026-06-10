/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Bundle the coupon artwork into the demo-pdf serverless function.
    outputFileTracingIncludes: {
      '/api/admin/demo-pdf': ['./playabowls_coupon_with_qr.png'],
    },
  },
}

module.exports = nextConfig
