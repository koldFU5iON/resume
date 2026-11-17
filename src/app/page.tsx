import { getSession } from '@/lib/session'
import { LandingPage } from './_components/landing/landing-page'

export default async function Home() {
  let isAuthenticated = false
  try {
    const session = await getSession()
    isAuthenticated = !!session
  } catch {
    // unauthenticated visitor
  }

  return <LandingPage isAuthenticated={isAuthenticated} />
}
