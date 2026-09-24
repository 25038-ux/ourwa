/** @type {import('next').NextConfig} */
const API = process.env.FORSA_API_URL || "http://localhost:8000";

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Same-origin proxy: the browser only talks to the web origin, so the session cookie stays
  // first-party (SameSite=Lax, httpOnly) and CORS is not needed in production.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
