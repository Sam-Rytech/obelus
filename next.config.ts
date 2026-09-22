import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ccxt", "@ethereum-attestation-service/eas-sdk", "ethers"],
};

export default nextConfig;
