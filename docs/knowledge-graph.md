# Profile graph retrieval for CV generation

The profile map already represents a knowledge graph: notes are entities and
`contains`, `has`, `demonstrates`, `uses` and `certifies` are typed relationships.
CV generation now queries those relationships before Select chooses evidence.
The map remains the editable source of truth. No vector index, graph service,
extra model call, database migration or second copy of profile data is needed.

## Flow

1. Gather loads the profile-scoped vault and derives an in-memory graph from the
   same snapshot used to build the candidate menu.
2. Brief runs as before. Its named lead-with/emphasise topics and the strategy's
   must-have/nice-to-have requirements become retrieval queries.
3. A whole-name match or conservative word overlap seeds retrieval. Capability
   links lead to supporting evidence, narratives or certifications; ownership
   links lead back to the project and role. A named project also retrieves its
   own evidence. No arbitrary traversal through sibling projects or activities.
4. Select gets a bounded, additional data section with selectable handles,
   matching seed handles where available, relationship types and link provenance.
   Its complete candidate menu stays available. Existing ID validation, caps,
   chronological coverage, proof-status checks and writer fact checks still apply.
5. If the model cannot choose, graph matches supply a small, bounded activity
   ranking bonus to the existing rules fallback. They create no additional picks.

The Gather and Select logs record graph availability and matching topic counts.
Selection still stores original profile IDs, so writers retrieve the original
evidence, including outcome qualifications, rather than graph-generated claims.

## Meaning and limits

- A graph hit is a relevance hint, **not** proof that a job requirement is met.
- `confirmed` records an owner decision. `exact` and `wikilink` are derived text
  links and remain labelled as such.
- `uses` supports the linked narrative; it never attaches its tool to every
  achievement underneath the role. `certifies` remains certification evidence,
  not employment experience.
- Matching follows names and words, not semantic embeddings. Different wording
  with no overlapping terms can be missed. The full menu remains available to
  the selector's language reasoning; an empty graph result is not a skills gap.
- Retrieval examines at most 24 distinct topics, alternating Brief priorities
  (lead-with, then emphasise) with job requirements (must-have, then nice-to-have).
  A shorter list leaves its spare slots for the other. It returns at most 40
  selectable notes per topic, filtering against the candidate menu before this
  limit. The prompt shows at most eight selectable matches per topic and 16,000
  characters of valid JSON. These are retrieval bounds, not candidate pruning.
- Identity and preferences are excluded. Profile contact details are scrubbed
  from graph text. Archived projects and their evidence are excluded. Graph IDs
  stay internal; only the existing menu's handles enter the additional prompt section.

## Freshness and maintenance

The projection is rebuilt on each Gather, so profile edits and confirmed/rejected
link decisions are reflected on the next run. Its canonical fingerprint includes
note text and typed edges with provenance and is part of the CV input hash.
Even a link-only edit therefore invalidates selection reuse. The selection
pipeline version is also bumped for the initial rollout.

Implementation: `src/modules/knowledge-graph/graph.ts` holds projection and
retrieval; `src/modules/cv-generation/graph-retrieval.ts` adapts them to CV
handles. Keep these modules pure and profile-local. Add new relationship traversal
rules explicitly, with tests that prevent evidence spreading to siblings.
