export const meta = {
  name: 'drift-judge',
  description: 'Blind-score drift-review reports against ground-truth answer keys',
  phases: [{ title: 'Judge', detail: 'one blinded judge per report' }],
}

const INBOX = '/home/bgibs/projects/agent-roster-observe-smoke/experiments/drift_corpus/_harness/judge_inbox'
const KEYS = '/home/bgibs/projects/agent-roster-observe-smoke/experiments/drift_corpus/_answerkey'

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['bid', 'stated_verdict', 'drift_scores', 'false_positives', 'real_unplanted'],
  properties: {
    bid: { type: 'string' },
    stated_verdict: { type: 'string', enum: ['ON TRACK', 'MINOR DRIFT', 'SIGNIFICANT DRIFT', 'unclear'] },
    drift_scores: {
      type: 'array',
      description: 'exactly one entry per planted drift id in the answer key',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'verdict'],
        properties: {
          id: { type: 'string', description: 'the planted drift id, e.g. TF-D3' },
          verdict: { type: 'string', enum: ['caught', 'partial', 'missed'] },
        },
      },
    },
    false_positives: {
      type: 'array',
      description: 'flags the report raised that are NOT real drift (it called something drift that is actually coherent, e.g. matches a coherent control, or an invented inconsistency)',
      items: { type: 'string' },
    },
    real_unplanted: {
      type: 'array',
      description: 'genuine inconsistencies the report found that are real but NOT in the planted drift set (should be rare)',
      items: { type: 'string' },
    },
  },
}

const DEFAULT_ITEMS = [
  { bid: 'R001', project: 'pulse-dashboard' }, { bid: 'R002', project: 'pulse-dashboard' },
  { bid: 'R003', project: 'pulse-dashboard' }, { bid: 'R004', project: 'pulse-dashboard' },
  { bid: 'R005', project: 'taskflow-api' }, { bid: 'R006', project: 'taskflow-api' },
  { bid: 'R007', project: 'pulse-dashboard' }, { bid: 'R008', project: 'taskflow-api' },
  { bid: 'R009', project: 'pulse-dashboard' }, { bid: 'R010', project: 'taskflow-api' },
  { bid: 'R011', project: 'pulse-dashboard' }, { bid: 'R012', project: 'taskflow-api' },
  { bid: 'R013', project: 'taskflow-api' }, { bid: 'R014', project: 'taskflow-api' },
  { bid: 'R015', project: 'pulse-dashboard' }, { bid: 'R016', project: 'taskflow-api' },
]
let items = DEFAULT_ITEMS
if (Array.isArray(args) && args.length) items = args
else if (args && typeof args === 'object' && Array.isArray(args.items) && args.items.length) items = args.items
else if (typeof args === 'string') { try { const p = JSON.parse(args); if (Array.isArray(p) && p.length) items = p } catch (e) { /* keep default */ } }
log(`judge: scoring ${items.length} reports`)

function prompt(bid, project) {
  return `You are STRICTLY scoring a documentation/code "coherence review" report against a ground-truth answer key. You do NOT know which tool or model produced the report — judge only its text.

1. Read the review report:  ${INBOX}/${bid}.md
2. Read the ground-truth answer key: ${KEYS}/${project}.json
   It has "drifts" (planted real inconsistencies, each with id/where/truth/detect) and "coherent_controls" (facts that are CONSISTENT and must NOT be reported as drift).

For EVERY planted drift in the key, decide the report's outcome:
- "caught": the report clearly identifies that specific inconsistency (names the right fact and the conflict / right direction). The exact wording need not match, but it must be the same finding.
- "partial": the report gestures at the area but is vague, hedged, or states the conflict wrong/backwards, so a reader could not act on it as the specific drift.
- "missed": the report does not identify it.
Be strict — a generic "double-check the config values" is NOT catching a specific numeric drift.

Then:
- false_positives: list each thing the report asserts is a drift/inconsistency that is actually COHERENT — especially any flag matching a coherent_control, or any invented mismatch. (Do NOT count a correctly-caught planted drift here.)
- real_unplanted: list any GENUINE inconsistency the report found that is real but not in the planted set (should be rare; use sparingly and only if clearly a true defect in the corpus).

Set bid to "${bid}". Output one drift_scores entry for EVERY planted drift id in the key. Return the structured object only.`
}

phase('Judge')
const scores = await parallel(items.map(it => () =>
  agent(prompt(it.bid, it.project), { label: `judge:${it.bid}`, phase: 'Judge', schema: SCHEMA })
    .then(s => (s ? { ...s, bid: it.bid, _project: it.project } : null))
))
return { scores: scores.filter(Boolean) }
