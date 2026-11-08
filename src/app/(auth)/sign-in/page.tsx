import Link from "next/link"
import { redirect } from "next/navigation"
import { getEnabledSocialProviders } from "@/lib/auth"
import { getSession } from "@/lib/session"
import { EmailPasswordForm } from "../_components/email-password-form"
import { SocialButtons } from "../_components/social-buttons"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const session = await getSession()
  const { callbackUrl } = await searchParams
  const target = callbackUrl || "/dashboard"

  if (session) {
    redirect(target)
  }

  const providers = getEnabledSocialProviders()

  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back. Sign in to your account.</p>
      </div>

      <EmailPasswordForm mode="signin" callbackUrl={target} />

      <p className="text-right -mt-2">
        <Link
          href="/forgot-password"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Forgot password?
        </Link>
      </p>

      <SocialButtons providers={providers} callbackUrl={target} />

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href={`/sign-up?${new URLSearchParams({ callbackUrl: target })}`} className="text-foreground font-medium hover:underline">
          Sign up
        </Link>
      </p>
    </>
  )
}
