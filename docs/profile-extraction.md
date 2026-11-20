# Extracting evidence from profile notes

Open **Evidence** on a role or project note and choose **Extract from saved note**. Review the original wording alongside the cleaned suggestion. **Save edits** keeps changes in the draft. **Accept**, **Replace match**, **Add to Overview**, and **Skip** resolve one item at a time. Return to the note to resume the same draft.

## Sources and proposals

The local parser reads Markdown under `## Achievements`, `## Responsibilities` or `## Scope`, and `## Skills`. `## Overview` is context already written into the note. Without a model key, the parser can also pick up straightforward first-person statements and action bullets in otherwise unstructured notes. Project extraction reads the project's legacy description and its note together.

Achievements should be standalone first-person claims. Clear duties become optional scope. An explicit comparison such as “Cut turnaround time from 3 weeks to 1 hour in Q3 2025” can supply a structured result. Tagged bullets also support quoted detail lines:

```markdown
## Achievements
- Cut turnaround time for billing exports
  > turnaround time: 1 hour (from 3 weeks), Q3 2025
  > Project: Billing exports
```

Known project names are looked up in the owning role, including Independent projects. A new label is a name suggestion until the owner accepts it. The label, outcome, and structured result can be edited in the draft.

When a user has configured their own model key, extraction can also submit unstructured prose with the `profile-extract` usage tag. Each model suggestion must include a genuine, contiguous excerpt. Result phrases, number-and-unit pairs and the direction of explicit comparisons are checked against it. A model response cannot discard a supported structured result found by the local parser. The local parser still works after a model failure. If an existing draft has pending items, a failed model run leaves them available for review.

## Draft and acceptance contract

- A draft belongs to exactly one role note or project note and has stable item IDs, a saved source fingerprint, and a version. The source fingerprint includes the note revision and text. For projects it also includes their owning role and description.
- Re-extraction writes to the same draft. Replacing pending suggestions and edits requires confirmation. Accepted and skipped source passages stay resolved across re-extractions of that note, even when the model changes classification or quote punctuation. The key uses the normalized source sentence where the excerpt starts, keeping separate sentences in the same paragraph distinct. If the source or draft changes in another tab or during an extraction, the old request is refused. Reload to see the saved state.
- Accepting an achievement checks all of the owning role's accepted achievements, including project labels and archived evidence. Exact duplicates cannot be added again. Fuzzy matches offer **Add as distinct achievement** for similar wording that describes different work. A match can be replaced explicitly when it still belongs to the same role and has a valid active label (or no label). Replacement updates the existing row so capability links, highlighting, and other metadata are preserved. It keeps the existing label unless the reviewer changes the draft's project selection. An empty draft outcome or result preserves its counterpart on a replacement. Compatible results retain omitted baseline and period fields. Both results are shown, and conflicting results require choosing **keep existing result** or **use suggested result** before replacement.
- A new project is created in the acceptance transaction and given the owning role. A same-name active project in that role is reused. Foreign, other-role and archived labels are refused.
- **Add to Overview** inserts a scope bullet in the source note and advances the note revision. Existing note text stays intact. Accepted achievements and skills are the only new structured profile data. The vault, snapshot, readiness checks and CV generation read accepted data and have no draft relation.
- Draft and evidence mutations share the profile ownership lock. Extraction releases the database while the model runs, then checks source and draft versions before saving. Accepting or skipping resolves the item in the same transaction. A repeated submission with an older draft version cannot write twice.

The additive `ProfileExtractionDraft` table has one unique foreign key per source kind and a constraint requiring exactly one source. Draft rows follow source deletion by cascade. Existing profile tables and accepted data require no migration writes. PR 5 still covers the CV Projects section for independent work. Generator changes stay paused until PR 6.

## Local validation

Apply migrations to a disposable local database, set `DATABASE_URL` to that database, and run:

```bash
PROFILE_EXTRACTION_INTEGRATION=1 npx vitest run src/modules/profile/extraction-draft.integration.test.ts --maxWorkers=2
npm run profile:roles-check
```

The extraction integration tests use disposable profiles and mock all model access.
