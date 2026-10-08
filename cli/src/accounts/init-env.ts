// Ensure client environment defaults are populated so common/src/env.ts validates
if (!process.env.NEXT_PUBLIC_CB_ENVIRONMENT) {
  process.env.NEXT_PUBLIC_CB_ENVIRONMENT = 'prod'
}
if (!process.env.NEXT_PUBLIC_CODEBUFF_APP_URL) {
  process.env.NEXT_PUBLIC_CODEBUFF_APP_URL = 'https://www.codebuff.com'
}
if (!process.env.NEXT_PUBLIC_SUPPORT_EMAIL) {
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'support@codebuff.com'
}
if (!process.env.NEXT_PUBLIC_POSTHOG_API_KEY) {
  process.env.NEXT_PUBLIC_POSTHOG_API_KEY = 'phc_placeholder'
}
if (!process.env.NEXT_PUBLIC_POSTHOG_HOST_URL) {
  process.env.NEXT_PUBLIC_POSTHOG_HOST_URL = 'https://us.i.posthog.com'
}
if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_placeholder'
}
if (!process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL) {
  process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL = 'https://billing.stripe.com'
}
if (!process.env.NEXT_PUBLIC_WEB_PORT) {
  process.env.NEXT_PUBLIC_WEB_PORT = '3000'
}
