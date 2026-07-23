/**
 * Local-only demo catalog for Intake → Compare → Report without shipping.
 * Admin + localhost only. Narratives avoid Cat 3/4 PII patterns.
 */

export const CHOOSE_DEMO = 'Choose a demo…'

export type LocalDemoScenario = {
  id: string
  /** Short label for the Intake picker */
  label: string
  /** What this scenario stresses in RAG / generator */
  focus: string
  case_id: string
  investigation_date: string
  facility_address: string
  credential_number: string
  selected_wacs: readonly string[]
  complaint: string
}

const META = {
  investigation_date: '07/22/2026',
  facility_address: '123 Demo Behavioral Health Way, Olympia, WA 98501',
  credential_number: 'BHA.FS.61140707',
} as const

/** At least 10 variable scenarios spanning BHA, RTF, RCW, and weak-match paths. */
export const LOCAL_DEMO_SCENARIOS: readonly LocalDemoScenario[] = [
  {
    id: 'assault_safety',
    label: '1 · Patient-to-patient assault / safety',
    focus: '0410 admin anchors + 0600 safety + RTF security/care',
    case_id: '2026-DEMO-01',
    ...META,
    selected_wacs: [
      'WAC 246-341-0410',
      'WAC 246-341-0420',
      'WAC 246-341-0600',
      'WAC 246-337-065',
      'WAC 246-337-080',
    ],
    complaint: `The Department of Health received a complaint alleging that a patient was sexually assaulted by another patient while residing at a behavioral health facility.

Staff allegedly failed to protect patient safety and security, including inadequate supervision on the unit after staff were informed of escalating conflict between the two patients. The complaint further alleged that the administrator failed to ensure day-to-day operations protected residents, that staffing was insufficient to monitor the milieu, and that facility policies on patient-to-patient assault and sexual harassment prevention were not followed.

The complainant reported that after the incident, staff delayed separating the patients and did not promptly document or escalate the event according to agency procedure.`,
  },
  {
    id: 'confidentiality_phi',
    label: '2 · PHI disclosure without consent',
    focus: '0425 record system + 0600 rights + RCW 71.05.020 definitions',
    case_id: '2026-DEMO-02',
    ...META,
    selected_wacs: [
      'WAC 246-341-0420',
      'WAC 246-341-0425',
      'WAC 246-341-0600',
      'RCW 71.05.020',
    ],
    complaint: `The Department of Health received a complaint alleging that agency staff disclosed protected health information about an adult patient to the patient's parent without the patient's consent.

The complaint states staff shared diagnosis, medication, and treatment appointment details during a phone call. The patient had not authorized family involvement. The complainant further alleged the agency lacked clear policies on when clinical information may be shared and that the individual service record system did not document the disclosure.`,
  },
  {
    id: 'restraint_seclusion',
    label: '3 · Restraint / seclusion event',
    focus: 'RTF 337-110 restraint + rights + admin accountability',
    case_id: '2026-DEMO-03',
    ...META,
    credential_number: 'BHA.FS.61140821',
    selected_wacs: [
      'WAC 246-337-110',
      'WAC 246-337-075',
      'WAC 246-337-045',
      'WAC 246-341-0410',
    ],
    complaint: `A complaint alleged that a resident was placed in seclusion for several hours after a verbal altercation, without timely physician authorization and without continuous monitoring documentation.

Staff reportedly used physical holds before seclusion. The complainant alleged residents were not informed of rights related to restraint and seclusion, that staff lacked training for de-escalation, and that governance failed to ensure policies on restraint use were followed and reviewed after the event.`,
  },
  {
    id: 'medication_errors',
    label: '4 · Medication management failures',
    focus: '337-105 meds + personnel + care services',
    case_id: '2026-DEMO-04',
    ...META,
    selected_wacs: [
      'WAC 246-337-105',
      'WAC 246-337-080',
      'WAC 246-337-050',
      'WAC 246-341-0515',
    ],
    complaint: `The complaint alleged repeated medication errors at a residential treatment facility, including missed evening doses and administration of the wrong dose of a psychiatric medication.

Staff allegedly failed to document medication administration accurately, did not notify a prescriber after an adverse reaction, and storage of controlled medications was left unlocked on one shift. The complainant also alleged inadequate staffing and supervision of medication-trained personnel.`,
  },
  {
    id: 'assessment_isp',
    label: '5 · Missing assessment / ISP',
    focus: 'Clinical assessment + individual service plan duties',
    case_id: '2026-DEMO-05',
    ...META,
    selected_wacs: [
      'WAC 246-341-0610',
      'WAC 246-341-0620',
      'WAC 246-341-0640',
      'WAC 246-341-0410',
    ],
    complaint: `A complaint alleged that an individual received outpatient behavioral health services for several weeks without a completed clinical assessment and without an individual service plan addressing goals and needed services.

Progress notes allegedly referenced treatment activities that were never tied to an approved plan. The complainant stated the administrator failed to ensure clinical policies requiring timely assessment and service planning were followed.`,
  },
  {
    id: 'grievance_rights',
    label: '6 · Rights / grievance process ignored',
    focus: '0600 rights + 0605 complaint process + policies',
    case_id: '2026-DEMO-06',
    ...META,
    selected_wacs: [
      'WAC 246-341-0600',
      'WAC 246-341-0605',
      'WAC 246-341-0420',
      'WAC 246-337-075',
    ],
    complaint: `The complainant alleged that when a patient attempted to file a grievance about staff mistreatment, agency staff discouraged the complaint, failed to provide written information about individual rights, and did not follow the agency complaint process timelines.

The patient reportedly asked for a copy of rights materials and was told to wait. No grievance log entry was created. The complaint also alleged posted rights were outdated and that staff were unfamiliar with the complaint procedure.`,
  },
  {
    id: 'infection_environment',
    label: '7 · Infection control / environment',
    focus: '337 infection control + facility environment + laundry',
    case_id: '2026-DEMO-07',
    ...META,
    credential_number: 'BHA.FS.61140903',
    selected_wacs: [
      'WAC 246-337-060',
      'WAC 246-337-120',
      'WAC 246-337-146',
      'WAC 246-337-045',
    ],
    complaint: `A complaint alleged unsanitary conditions in a residential treatment facility, including unclean resident bathrooms, soiled linens left in hallways, and failure to isolate a resident with a contagious illness according to infection control procedures.

Staff allegedly lacked personal protective equipment on one weekend shift. Governance was alleged to have failed to ensure infection control policies and environmental cleaning schedules were implemented and monitored.`,
  },
  {
    id: 'qi_critical_incident',
    label: '8 · Quality improvement / critical incident',
    focus: '337-048 QI data + 0410 quality plan anchors',
    case_id: '2026-DEMO-08',
    ...META,
    selected_wacs: [
      'WAC 246-337-048',
      'WAC 246-341-0410',
      'WAC 246-337-045',
      'WAC 246-341-0420',
    ],
    complaint: `Following a serious resident injury during a behavioral escalation, a complaint alleged the facility did not collect or review quality improvement data on critical incidents, did not implement corrective actions, and did not update policies to prevent recurrence.

The complainant alleged the administrator failed to maintain an internal quality management plan addressing incident response, staff training, and monitoring of compliance after substantiated events.`,
  },
  {
    id: 'crisis_outreach',
    label: '9 · Crisis outreach response delay',
    focus: 'Crisis MH services + DCR-related standards',
    case_id: '2026-DEMO-09',
    ...META,
    selected_wacs: [
      'WAC 246-341-0900',
      'WAC 246-341-0910',
      'WAC 246-341-0915',
      'WAC 246-341-0410',
    ],
    complaint: `A complaint alleged that after a family requested crisis outreach for an individual in acute distress, the agency delayed dispatch for many hours, failed to document outreach attempts, and did not provide stabilization follow-up as described in crisis service standards.

Callers allegedly were given inconsistent information about response times. The complaint further alleged administrative oversight of crisis staffing and documentation was inadequate.`,
  },
  {
    id: 'otp_dosing',
    label: '10 · Opioid treatment program dosing',
    focus: 'OTP certification + medical director + record content',
    case_id: '2026-DEMO-10',
    ...META,
    credential_number: 'BHA.FS.61141015',
    selected_wacs: [
      'WAC 246-341-1000',
      'WAC 246-341-1020',
      'WAC 246-341-1015',
      'WAC 246-341-0410',
    ],
    complaint: `A complaint alleged an opioid treatment program dispensed take-home doses inconsistent with the individual's phase of treatment, without required medical director review, and with incomplete individual service record documentation of dosing decisions.

Staff allegedly failed to follow OTP policies for missed doses and did not document counseling contacts. The complainant stated program administration did not ensure medical director responsibilities and record standards were met.`,
  },
  {
    id: 'youth_inpatient_rights',
    label: '11 · Youth inpatient rights / notice',
    focus: 'Youth MH inpatient + parental notice themes (71.34)',
    case_id: '2026-DEMO-11',
    ...META,
    selected_wacs: [
      'WAC 246-341-1128',
      'WAC 246-341-1130',
      'WAC 246-341-0600',
      'RCW 71.34.510',
    ],
    complaint: `A complaint alleged that an adolescent admitted for inpatient mental health treatment was not informed of rights in an age-appropriate manner, and that required notice to parents regarding the voluntary admission was delayed.

Staff allegedly restricted family contact without documenting clinical justification. The complainant further alleged policies for treatment of minors and individual rights posting/practices were not followed.`,
  },
  {
    id: 'weak_overlap',
    label: '12 · Weak overlap (low confidence)',
    focus: 'Should stay low-confidence / not invent strong duties',
    case_id: '2026-DEMO-12',
    ...META,
    selected_wacs: ['WAC 246-341-0600'],
    complaint: `The complainant reported dissatisfaction with cafeteria menu options, parking availability, and the color of the waiting-room chairs.

No clinical safety, rights, treatment, or privacy concerns were described beyond general dissatisfaction with amenities.`,
  },
] as const

/** @deprecated Prefer LOCAL_DEMO_SCENARIOS[0] — kept for older imports. */
export const LOCAL_QUICK_DRAFT = LOCAL_DEMO_SCENARIOS[0]

export type LocalQuickDraft = LocalDemoScenario

export function getLocalDemoById(id: string): LocalDemoScenario | undefined {
  return LOCAL_DEMO_SCENARIOS.find((d) => d.id === id)
}

/** True on Vite dev or when the app is opened on localhost (local prod build). */
export function isLocalDemoHost(): boolean {
  if (typeof window === 'undefined') return Boolean(import.meta.env.DEV)
  if (import.meta.env.DEV) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}
