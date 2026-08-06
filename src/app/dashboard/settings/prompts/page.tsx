import { ContentContainer } from '@/app/components/ContentContainer'
import { requireProfile } from '@/lib/session'
import { loadAllDefaultPrompts, loadPromptOverrides } from '@/modules/prompts/loader'
import { PROMPT_REGISTRY } from '@/modules/prompts/registry'
import { PromptsForm } from './_components/prompts-form'

export default async function Page() {
  const { profile } = await requireProfile()

  const [defaults, overrides] = await Promise.all([
    loadAllDefaultPrompts(),
    loadPromptOverrides(profile.id),
  ])

  return (
    <ContentContainer
      title="Prompts"
      description="Edit the AI prompts behind each feature. Your overrides apply to your account only; defaults are the built-in prompts shipped with the app."
    >
      <PromptsForm
        registry={PROMPT_REGISTRY}
        defaults={defaults}
        overrides={overrides}
      />
    </ContentContainer>
  )
}
