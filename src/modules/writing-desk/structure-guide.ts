import type { CVDocumentContent } from "@/modules/cv/schema"

export type StructureGuide = {
  source: "master-cv" | "default"
  sections: Array<{ key: string; heading: string }>
}

export const DEFAULT_CV_STRUCTURE: StructureGuide["sections"] = [
  { key: "header", heading: "Header" },
  { key: "profile", heading: "Professional Profile" },
  { key: "competencies", heading: "Core Competencies" },
  { key: "experience", heading: "Professional Experience" },
  { key: "tools", heading: "Tools" },
  { key: "skills", heading: "Skills" },
  { key: "certification", heading: "Certifications" },
  { key: "education", heading: "Education" },
  { key: "languages", heading: "Languages" },
]

const TYPE_HEADINGS: Record<string, string> = {
  header: "Header",
  profile: "Professional Profile",
  competencies: "Core Competencies",
  capabilities: "Capabilities",
  experience: "Professional Experience",
  education: "Education",
  certification: "Certifications",
  skills: "Skills",
  tools: "Tools",
  languages: "Languages",
}

export function buildStructureGuide(master: CVDocumentContent | null): StructureGuide {
  const sections: StructureGuide["sections"] = []
  for (const section of master?.sections ?? []) {
    if (!section.visible) continue
    const heading = section.type === "custom" ? section.data.heading : TYPE_HEADINGS[section.type]
    if (heading) sections.push({ key: section.type, heading })
  }
  if (sections.length === 0) return { source: "default", sections: DEFAULT_CV_STRUCTURE }
  return { source: "master-cv", sections }
}
