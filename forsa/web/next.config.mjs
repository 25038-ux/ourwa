/** @type {import('next').NextConfig} */
const API = process.env.FORSA_API_URL || "http://localhost:8000";

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Same-origin proxy: the browser only talks to the web origin, so the session cookie stays
  // first-party (SameSite=Lax, httpOnly) and CORS is not needed in production.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      // Android Trusted Web Activity verification (fingerprints come from FORSA_ANDROID_SHA256 on the API).
      { source: "/.well-known/assetlinks.json", destination: `${API}/api/v1/meta/assetlinks` },
    ];
  },
  async headers() {
    return [
      {
        // The service worker must always be revalidated so app updates reach installed PWAs.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Microphone is allowed for this origin only: voice dictation for the assistant and onboarding.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
