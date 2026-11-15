import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function SectionHelp({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <button
          type="button"
          aria-label="Section help"
          className="inline-flex size-6 items-center justify-center text-muted-foreground/40 hover:text-muted-foreground transition-colors max-md:size-11"
        />
      }>
        <Info size={12} />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56 text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
