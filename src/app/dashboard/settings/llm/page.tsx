import { ContentContainer } from '@/app/components/ContentContainer'
import { requireProfile } from '@/lib/session'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMSettingsForm } from './_components/llm-settings-form'

export default async function Page() {
  const { profile } = await requireProfile()
  const status = await getLLMConfigStatus(profile.id)

  return (
    <ContentContainer
      title="LLM"
      description="Connect your own AI provider — costs land on your account, not the app's."
    >
      <LLMSettingsForm
        initial={{
          provider: status.provider ?? 'anthropic',
          model: status.model ?? '',
          keyConfigured: status.configured,
          availableModels: status.availableModels,
          availableModelsUpdatedAt: status.availableModelsUpdatedAt,
        }}
      />
    </ContentContainer>
  )
}
