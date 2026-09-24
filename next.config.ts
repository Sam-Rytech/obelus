import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ccxt", "@ethereum-attestation-service/eas-sdk", "ethers"],
  // /method was renamed; old links (and the Telegram bot's) keep working.
  async redirects() {
    return [{ source: "/method", destination: "/how-it-works", permanent: true }];
  },
};

export default nextConfig;
