import Link from "next/link"
import { redirect } from "next/navigation"
import { getEnabledSocialProviders } from "@/lib/auth"
import { getSession } from "@/lib/session"
import { EmailPasswordForm } from "../_components/email-password-form"
import { SocialButtons } from "../_components/social-buttons"

export default async function SignUpPage({
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
        <h1 className="text-2xl font-bold">Create an account</h1>
        <p className="text-sm text-muted-foreground">Start tracking your job applications.</p>
      </div>

      <EmailPasswordForm mode="signup" callbackUrl={target} />
      <SocialButtons providers={providers} callbackUrl={target} />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={`/sign-in?${new URLSearchParams({ callbackUrl: target })}`} className="text-foreground font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  )
}
