import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { LOCAL_DEMO_SCENARIOS, LOCAL_QUICK_DRAFT } from '../frontend/src/fixtures/localQuickDraft.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const catalog = {
  notes:
    'Mirror of frontend/src/fixtures/localQuickDraft.ts — local admin demos for Intake→Compare→Report (exact WAC duties, top-2 starters + duty checkboxes). Not ingested by template_corpus.',
  updated: '2026-07-31',
  scenarios: LOCAL_DEMO_SCENARIOS.map((s) => ({ ...s })),
}

fs.writeFileSync(
  path.join(root, 'data/examples/local_demo_catalog.json'),
  JSON.stringify(catalog, null, 2) + '\n',
  'utf8',
)

fs.writeFileSync(
  path.join(root, 'data/examples/local_quick_draft.json'),
  JSON.stringify(
    {
      ...LOCAL_QUICK_DRAFT,
      notes:
        'Local UI demo alias of LOCAL_DEMO_SCENARIOS[0] (assault_safety). Mirrors frontend/src/fixtures/localQuickDraft.ts. Not ingested by template_corpus.',
    },
    null,
    2,
  ) + '\n',
  'utf8',
)

console.log(`Wrote ${catalog.scenarios.length} scenarios to data/examples/`)
