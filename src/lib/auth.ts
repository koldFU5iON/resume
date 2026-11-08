import { betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { nextCookies } from "better-auth/next-js"
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { Resend } from "resend"
import { prisma } from "@/lib/db"
import { getMcpUrls, MCP_OAUTH_SCOPES } from "@/modules/mcp/oauth-config"
import { getMcpGrantClaims } from "@/modules/mcp/oauth-grants"
import { enforceMcpRegistrationLimit } from "@/modules/mcp/registration-limit"

type SocialProviderConfig = { clientId: string; clientSecret: string }

function normalizeOrigin(value?: string) {
  if (!value) return undefined
  const withProtocol = value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`
  return withProtocol.replace(/\/$/, "")
}

const vercelUrl = normalizeOrigin(process.env.VERCEL_URL)
const vercelProductionUrl = normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL)
const authBaseUrl = normalizeOrigin(process.env.BETTER_AUTH_URL) ?? vercelUrl ?? getMcpUrls().origin
const envTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ?.split(",")
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter((origin): origin is string => Boolean(origin)) ?? []

const trustedOrigins = [authBaseUrl, vercelUrl, vercelProductionUrl, ...envTrustedOrigins]
  .filter((origin): origin is string => Boolean(origin))

const socialProviders: Record<string, SocialProviderConfig> = {}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}

if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
  socialProviders.linkedin = {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  }
}

if (process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET) {
  socialProviders.twitter = {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
  }
}

export type EnabledSocialProvider = "google" | "linkedin" | "twitter"

export function getEnabledSocialProviders(): EnabledSocialProvider[] {
  return Object.keys(socialProviders) as EnabledSocialProvider[]
}

export const auth = betterAuth({
  baseURL: authBaseUrl,
  trustedOrigins,
  disabledPaths: ["/token"],
  rateLimit: {
    enabled: true,
    storage: "database",
    customRules: {
      // Registration uses an atomic before-hook instead of the response counter.
      "/oauth2/register": false,
      "/oauth2/public-client-prelogin": { window: 60, max: 30 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (ctx.path === "/oauth2/register") await enforceMcpRegistrationLimit(ctx.headers)
    }),
  },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const senderEmail = process.env.SENDER_EMAIL ?? "no-reply@example.com"
      await resend.emails.send({
        from: senderEmail,
        to: user.email,
        subject: "Reset your password",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="font-size:20px;font-weight:600;margin:0 0 8px">Reset your password</h2>
            <p style="color:#6b7280;margin:0 0 24px">
              We received a request to reset the password for your account.
              Click the button below to choose a new password.
              This link expires in 1 hour.
            </p>
            <a href="${url}"
               style="display:inline-block;background:#09090b;color:#fafafa;text-decoration:none;
                      padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
              Reset password
            </a>
            <p style="color:#9ca3af;font-size:12px;margin:24px 0 0">
              If you didn't request this, you can safely ignore this email.
              Your password won't change.
            </p>
          </div>
        `,
      })
    },
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders,
  account: {
    accountLinking: {
      trustedProviders: ["linkedin", "google", "twitter"],
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await prisma.profile.create({
            data: {
              userId: user.id,
              name: user.name || user.email.split("@")[0],
            },
          })
        },
      },
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/mcp/login",
      consentPage: "/mcp/consent",
      scopes: [...MCP_OAUTH_SCOPES],
      validAudiences: [getMcpUrls().resource],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      allowPublicClientPrelogin: true,
      clientRegistrationDefaultScopes: [...MCP_OAUTH_SCOPES],
      accessTokenExpiresIn: 60 * 60,
      refreshTokenExpiresIn: 60 * 60 * 24 * 30,
      customAccessTokenClaims: getMcpGrantClaims,
      // These clients are only for MCP authorization, not application management.
      clientPrivileges: () => false,
      silenceWarnings: { oauthAuthServerConfig: true },
    }),
    nextCookies(),
  ],
})
