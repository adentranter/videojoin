import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  agentRules: false,
};

export default nextConfig;
