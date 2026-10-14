import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: process.env.ATLAS_SELF_HOSTED === "1" ? { cpus: 1 } : undefined,
  webpack(config, { webpack }) {
    if (process.env.ATLAS_SELF_HOSTED === "1") {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /^cloudflare:workers$/,
        process.cwd() + "/deploy/sqlite-env.mjs",
      ));
    }
    return config;
  },
};

export default nextConfig;
