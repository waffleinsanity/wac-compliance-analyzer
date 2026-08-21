/**
 * SOD pack shell text mirrored from backend/app/services/sod_blank.py.
 * Structure/voice only. Statute cites and regulation wording stay PDF-backed.
 */

export const SOD_TITLE = 'Statement of Deficiency Report'

export const SOD_TABLE_HEADERS = [
  'Deficiency Number and Rule Reference',
  'Observation Findings',
  'Plan of Correction',
] as const

export const SOD_HEADER_LABELS = {
  agency: 'Facility Name and Address',
  administrator: 'Administrator',
  inspection_type: 'Inspection Type',
  investigation_start: 'Investigation Start Date',
  investigator_number: 'Investigator Number',
  case_number: 'Case Number(s)',
  license_number: 'License Number',
  services_type: 'BHA/RTF Facility Services Type',
} as const

export const SOD_DISCLAIMER =
  'Please note that the deficiencies/violations/observations noted in this report ' +
  'are not all-inclusive, but rather were deficiencies/violations/observations that ' +
  'were observed or discovered during the investigation.'

export const SOD_ENFORCEMENT_RCW_HINT =
  "You may receive notice of the Department's intent to take enforcement action " +
  'against your license under RCW 71.24.037, 71.12, WAC 246-337-021 and ' +
  'WAC 246-341-0335 based on any deficiency listed on the enclosed report. ' +
  'Your submission of a Plan of Correction or any other action you take in ' +
  'response to this Statement of Deficiency Report may be taken into consideration ' +
  'in an enforcement action but does not prevent the Department from proceeding ' +
  'with enforcement action.'

export const SOD_POC_ELEMENTS = [
  'The regulation number',
  'How the deficiency will be corrected',
  'Who is responsible for making the correction',
  'When the correction will be completed',
  'How you will ensure that the deficiency has been successfully corrected. ' +
    'When monitoring activities are planned, objectives must be measurable and ' +
    'quantifiable. Please include information about the monitoring time frame and ' +
    'number of planned observations.',
] as const

export const SOD_DOH_RETURN_BLOCK =
  'Department of Health\n' +
  'HSQA/Office of Health Systems Oversight\n' +
  'PO Box 47874\n' +
  'Olympia, Washington 98504-7874'

export const FINDINGS_INCLUDED_LABEL = 'Findings included:'

/** Core SOD Writing.pptx principles shown to investigators (structure/voice only). */
export const SOD_WRITING_PRINCIPLES = [
  'Based on must name two or more of observation, interview, and document review.',
  'Every evidence type named in Based on must have a matching Findings included row.',
  'Based on must echo the cited WAC/RCW duty language.',
  'Failure to states the risk if the failed practice is left uncorrected.',
  'Findings use showed for records, stated / stated that for interviews.',
  'Refer to clients as patients and staff as Staff A, Staff B from the identifier key.',
  'Plan of Correction stays blank for the facility.',
] as const

export function coverLetterParagraphs(args: {
  facilityName: string
  facilityAddress: string
  administrator: string
  completedOn: string
  investigatorNumber: string
  pocDueDays?: number
  letterDate?: string
}): string[] {
  const name = (args.facilityName || '').trim() || 'N/A'
  const addr = (args.facilityAddress || '').trim() || 'N/A'
  const admin = (args.administrator || '').trim() || 'N/A'
  const done = (args.completedOn || '').trim() || 'N/A'
  const inv = (args.investigatorNumber || '').trim() || 'N/A'
  const dear = admin !== 'N/A' ? admin : 'Administrator'
  const pocDueDays = args.pocDueDays ?? 14
  const dated = (args.letterDate || '').trim()
  const lines = [
    'STATE OF WASHINGTON',
    'DEPARTMENT OF HEALTH',
    'PO Box 47874, Olympia, Washington 98504-7874',
  ]
  if (dated) lines.push(dated)
  lines.push(
    name,
    addr,
    `Dear: ${dear}:`,
    `This letter contains information regarding the investigation at ${name} ` +
      `by the Washington State Department of Health. Your state licensing investigation ` +
      `was completed on ${done}.`,
    'During the investigation, deficient practice was found in the areas listed on the ' +
      'attached Statement of Deficiency Report. A written Plan of Correction is required ' +
      'for each deficiency listed on the Statement of Deficiency Report and will be due ' +
      `${pocDueDays} days after you receive this letter.`,
    'Each plan of correction statement must include the following:',
    ...SOD_POC_ELEMENTS.map((item) => `- ${item}`),
    'You are not required to write the Plan of Correction on the Statement of Deficiency Report.',
    SOD_ENFORCEMENT_RCW_HINT,
    'Please email the report and Plans of Correction to the Investigator. You can also ' +
      'sign and send the original reports and Plans of Correction to the Investigator at ' +
      'the following address:',
    `Investigator: ${inv}`,
    SOD_DOH_RETURN_BLOCK,
    'Enclosures: Statement of Deficiency Report; Plan of Correction Instructions',
  )
  return lines
}

export function pocInstructionParagraphs(): string[] {
  return [
    'Plan of Correction Instructions',
    'Introduction',
    'We require that you submit a plan of correction for each deficiency listed on the ' +
      'statement of deficiency form. Your plan of correction must be submitted to DOH ' +
      'within fourteen calendar days of receipt of the list of deficiencies.',
    'You are required to respond to the statement of deficiencies by submitting a plan of ' +
      'correction (POC). Be sure to refer to the deficiency number. If you include exhibits, ' +
      'identify them and refer to them as such in your POC.',
    'Descriptive Content',
    'Your plan of correction must provide a step-by-step description of the methods to ' +
      'correct each deficient practice to prevent recurrence and provide information that ' +
      'ensures the intent of the regulation is met.',
    'An acceptable plan of correction must contain the following elements:',
    '- The plan of correcting the specific deficiency;',
    '- The procedure for implementing the acceptable plan of correction for the specific deficiency cited;',
    '- The monitoring procedure to ensure that the plan of correction is effective and that ' +
      'specific deficiency cited remains corrected and/or in compliance with the regulatory requirements;',
    '- The title of the person responsible for implementing the acceptable plan of correction.',
    'Simply stating that a deficiency has been "corrected" is not acceptable. If a deficiency ' +
      'has already been corrected, the plan of correction must include the following:',
    '- How the deficiency was corrected,',
    '- The completion date (date the correction was accomplished),',
    '- How the plan of correction will prevent possible recurrence of the deficiency.',
    'Completion Dates',
    'The POC must include a completion date that is realistic and coinciding with the amount ' +
      'of time your facility will need to correct the deficiency. Direct care issues must be ' +
      'corrected immediately and monitored appropriately. Some deficiencies may require a staged ' +
      'plan to accomplish total correction. Deficiencies that require bids, remodeling, ' +
      'replacement of equipment, etc., may need more time to accomplish correction; the target ' +
      'completion date, however, should be within a reasonable and mutually agreeable time-frame.',
    'Continued Monitoring',
    'Each plan of correction must indicate the appropriate person, either by position or title, ' +
      'who will be responsible for monitoring the correction of the deficiency to prevent recurrence.',
    'Checklist:',
    'Before submitting your plan of correction, please use the checklist below to prevent delays.',
    '- Have you provided a plan of correction for each deficiency listed?',
    '- Does each plan of correction show a completion date of when the deficiency will be corrected?',
    '- Is each plan descriptive as to how the correction will be accomplished?',
    '- Have you indicated what staff position will monitor the correction of each deficiency?',
    '- If you included any attachments, have they been identified with the corresponding ' +
      'deficiency number or identified with the page number to which they are associated?',
    'Your plan of correction will be returned to you for proper completion if not filled out according to these guidelines.',
    'Note: Failure to submit an acceptable plan of correction may result in enforcement action.',
    'Approval of POC',
    'Your submitted POC will be reviewed for adequacy by DOH. If your POC does not adequately ' +
      'address the deficiencies, you will be sent a letter detailing why your POC was not accepted.',
    'Questions?',
    'Please review the cited regulation first. If you need clarification or have questions about ' +
      'deficiencies, you must contact the investigator who conducted the investigation.',
  ]
}

type FindingLike = { method?: string; text?: string }
type ItemLike = { number?: number; title?: string; findings?: FindingLike[] }
type DeficiencyLike = {
  based_on?: string
  failure_to?: string
  reference?: string
  findings?: FindingLike[]
  items?: ItemLike[]
}

function findingLine(n: number, finding: FindingLike, number: boolean): string {
  const method = (finding.method || '').trim()
  const body = (finding.text || '').trim()
  let text = body
  if (method && !body) text = method
  const prefix = number ? `${n}. ` : ''
  return `${prefix}${text}`.trim()
}

/** Mirror backend format_findings_column for Observation Findings cell. */
export function formatFindingsColumn(deficiency: DeficiencyLike): string {
  const parts: string[] = []
  const based = (deficiency.based_on || '').trim()
  const fail = (deficiency.failure_to || '').trim()
  if (based) parts.push(based)
  if (fail) parts.push(fail)
  const ref = (deficiency.reference || '').trim()
  if (ref) parts.push(`Reference: ${ref}`)
  parts.push(FINDINGS_INCLUDED_LABEL)
  const numbered: string[] = []
  const items = deficiency.items || []
  if (items.length) {
    for (const it of items) {
      const head = `Item #${it.number ?? 1} - ${it.title || ''}`.replace(/\s*-\s*$/, '').trim()
      if (head) numbered.push(head)
      const fins = it.findings || []
      fins.forEach((f, i) => numbered.push(findingLine(i + 1, f, fins.length > 1)))
    }
  } else {
    const fins = deficiency.findings || []
    fins.forEach((f, i) => numbered.push(findingLine(i + 1, f, fins.length > 1)))
  }
  if (numbered.length) parts.push(...numbered)
  return parts.filter(Boolean).join('\n\n')
}
