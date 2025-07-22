/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@octokit/webhooks'],
  env: {
    GH_APP_ID: process.env.GH_APP_ID || process.env.APP_ID,
    GH_WEBHOOK_SECRET: process.env.GH_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET,
    GH_PRIVATE_KEY: process.env.GH_PRIVATE_KEY || process.env.PRIVATE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    MAX_TOKENS: process.env.MAX_TOKENS,
    ENABLE_CACHING: process.env.ENABLE_CACHING,
    CACHE_TIMEOUT: process.env.CACHE_TIMEOUT,
    ENABLE_DETAILED_LOGGING: process.env.ENABLE_DETAILED_LOGGING,
    MIN_COMMENT_LENGTH: process.env.MIN_COMMENT_LENGTH,
  },
};

export default nextConfig;
