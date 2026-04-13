import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['100.120.135.98', 'subpetrosal-aversive-anitra.ngrok-free.dev'],
  output: 'standalone',
  devIndicators: false,
};

export default nextConfig;
