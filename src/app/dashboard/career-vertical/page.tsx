import { requireProfile } from '@/lib/session'
import { ContentContainer } from '@/app/components/ContentContainer'
import {
  getCareerVertical,
  getMasterCVForVertical,
  listVerticalCandidateJobs,
} from '@/modules/career-vertical/queries'
import { CareerVerticalWorkspace } from './_components/career-vertical-workspace'

export default async function CareerVerticalPage() {
  const { profile } = await requireProfile()

  const [vertical, jobs] = await Promise.all([
    getCareerVertical(profile.id),
    listVerticalCandidateJobs(profile.id),
  ])

  const masterCV = vertical ? await getMasterCVForVertical(profile.id, vertical.id) : null

  return (
    <ContentContainer
      title="Career Vertical"
      description="Analyse the jobs you're targeting to surface the hiring pattern behind them, then build a master CV that captures your core professional identity."
    >
      <CareerVerticalWorkspace initialVertical={vertical} jobs={jobs} masterCV={masterCV} />
    </ContentContainer>
  )
}
