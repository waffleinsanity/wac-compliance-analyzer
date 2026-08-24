import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { LOCAL_DEMO_SCENARIOS, LOCAL_QUICK_DRAFT } from '../frontend/src/fixtures/localQuickDraft.ts'
import { demoEvidenceForScenario } from '../frontend/src/fixtures/localDemoEvidence.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const catalog = {
  notes:
    'Mirror of frontend/src/fixtures/localQuickDraft.ts — admin demos for Intake→Compare→Report. ' +
    'Exact WAC duties (no see-also shortcuts), top-2 starters + duty checkboxes, blank IR shell fields ' +
    '(investigation_type, priorities). Policy guidance under data/examples/policy_guidance/. ' +
    'Demo evidence packs from localDemoEvidence.ts are uploaded when Load & draft saves a case. ' +
    'Not ingested by template_corpus.',
  updated: '2026-08-24',
  core_documents: {
    blank_ir: 'data/templates/5. Investigation report.docx',
    baseline_allegations: 'data/examples/Baseline Allegations RTF.txt',
    policy_guidance: 'data/examples/policy_guidance/',
    demo_evidence: 'frontend/src/fixtures/localDemoEvidence.ts',
  },
  scenarios: LOCAL_DEMO_SCENARIOS.map((s) => ({
    ...s,
    evidence: demoEvidenceForScenario(s).map((e) => ({
      title: e.title,
      filename: e.filename,
      linked_wac_ids: e.linked_wac_ids || [],
      body_chars: e.body.length,
    })),
  })),
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
