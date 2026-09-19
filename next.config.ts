import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: '/scout/:path*',
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    }]
  },
  serverExternalPackages: ['@react-pdf/renderer'],
  // Pin the workspace root so Turbopack doesn't pick up the stray lockfile
  // at /home/devons/ as the project root.
  turbopack: {
    root: path.resolve(),
  },
  // Ensure the skill source markdown files are included in the serverless
  // function bundle. Next.js's static analysis won't see fs.readFile() paths
  // computed from process.cwd(), so list them explicitly.
  outputFileTracingIncludes: {
    "/api/integrations/skills/[agent]": [
      "./src/lib/integrations/skills/*.md",
    ],
    "/dashboard/**": [
      "./src/lib/prompts/*.md",
    ],
    "/api/**": [
      "./src/lib/prompts/*.md",
    ],
  },
};

export default nextConfig;
