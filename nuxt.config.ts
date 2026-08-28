export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  routeRules: {
    '/**': {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    },
    '/api/admin/**': { headers: { 'Cache-Control': 'no-store' } },
    '/api/auth/**': { headers: { 'Cache-Control': 'no-store' } },
    '/api/profile/**': { headers: { 'Cache-Control': 'no-store' } },
    '/api/scores': { headers: { 'Cache-Control': 'no-store' } },
  },
  runtimeConfig: {
    databaseUrl: '',
    redisUrl: '',
    githubClientId: '',
    githubClientSecret: '',
    githubOauthBaseUrl: 'https://github.com',
    githubApiBaseUrl: 'https://api.github.com',
    githubRedirectUrl: '',
  },
})
