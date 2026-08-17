/**
 * Admin demo catalog for Intake → Compare → Report (IR Download DOCX; local and Railway).
 * Narratives avoid Cat 3/4 PII patterns. Not ingested by template_corpus.
 *
 * Tuned for the current Investigation Report product (2026-07-31):
 * - Officially approved WAC multi-select drives the draft (suggestions never auto-authorize)
 * - Allegations use full exact PDF duty language (Baseline shape; never "; see also" shortcuts)
 * - Compare starts with the two strongest duties; checkboxes add more
 * - Report Edit dropdowns (investigation type, priorities, actions) update the IR + Download
 * - Working-draft Download DOCX is always available; evidence attach is multi-file optional
 * - Blank IR shell: data/templates/5. Investigation report.docx
 * - Peer / SOD policy guidance: data/examples/policy_guidance/ (desk manuals + samples)
 */

export const CHOOSE_DEMO = 'Choose a demo…'

export type LocalDemoScenario = {
  id: string
  /** Short label for the Intake picker */
  label: string
  /** What this scenario stresses in ranking / allegation drafting / Report shell */
  focus: string
  case_id: string
  investigation_date: string
  facility_address: string
  credential_number: string
  /** Blank IR investigation-type content control */
  investigation_type: string
  state_licensing_priority: string
  federal_certification_priority: string
  selected_wacs: readonly string[]
  complaint: string
}

const META = {
  investigation_date: '07/31/2026',
  facility_address: '123 Demo Behavioral Health Way, Olympia, WA 98501',
  credential_number: 'BHA.FS.61140707',
  investigation_type: 'On-site State Investigation',
  state_licensing_priority: 'C',
  federal_certification_priority: 'Non-IJ Medium',
} as const

/** At least 10 variable scenarios spanning BHA, RTF, RCW, weak-match, and Report shell fields. */
export const LOCAL_DEMO_SCENARIOS: readonly LocalDemoScenario[] = [
  {
    id: 'assault_safety',
    label: '1 · Patient-to-patient assault / safety',
    focus:
      'Exact 0410/0600 duties (no see-also); top-2 Compare starters; On-site State IR shell + priorities for Download',
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
    focus:
      'Exact 0425/0600 + RCW 71.05.020 duty language; privacy banner path; Off-site State shell fields',
    case_id: '2026-DEMO-02',
    ...META,
    investigation_type: 'Off-site State Investigation',
    state_licensing_priority: 'B',
    federal_certification_priority: 'N/A',
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
    label: '3 · Restraint / seclusion + governance',
    focus:
      '337-110 + 045 governance leaves; Baseline gerund duties (adopting/providing); On-site State and Federal type',
    case_id: '2026-DEMO-03',
    ...META,
    credential_number: 'BHA.FS.61140821',
    investigation_type: 'On-site State and Federal Investigation',
    state_licensing_priority: 'A',
    federal_certification_priority: 'Non-IJ High',
    selected_wacs: [
      'WAC 246-337-110',
      'WAC 246-337-075',
      'WAC 246-337-045',
      'WAC 246-341-0410',
    ],
    complaint: `A complaint alleged that a resident was placed in seclusion for several hours after a verbal altercation, without timely physician authorization and without continuous monitoring documentation.

Staff reportedly used physical holds before seclusion. The complainant alleged residents were not informed of rights related to restraint and seclusion, and that staff lacked training for de-escalation.

Governance failed at the RTF: no adopted policies were periodically reviewed or updated, the communication and conflict-resolution process for staff and residents was absent, and the personnel system did not track qualifications or supervision of clinical staff who provide direct resident care.`,
  },
  {
    id: 'medication_errors',
    label: '4 · Medication management failures',
    focus:
      '337-105 meds + 080 care exact labeled duties; Edit priorities flow into Download DOCX; multi-file evidence optional',
    case_id: '2026-DEMO-04',
    ...META,
    state_licensing_priority: 'B',
    federal_certification_priority: 'Non-IJ Low',
    selected_wacs: [
      'WAC 246-337-105',
      'WAC 246-337-080',
      'WAC 246-337-050',
      'WAC 246-341-0510',
    ],
    complaint: `The complaint alleged repeated medication administration errors at a residential treatment facility, including missed evening doses, wrong-dose administration of a psychiatric medication, and failure to report medication errors, adverse effects, and side effects.

Staff allegedly failed to document medication administration accurately, did not notify a prescriber after an adverse reaction, left controlled medications unlocked on one shift, and did not follow prescribing and administering drugs procedures. The complainant also alleged inadequate staffing and supervision of medication-trained personnel.`,
  },
  {
    id: 'assessment_isp',
    label: '5 · Missing assessment / ISP',
    focus:
      '0640 clinical documentation + 0410 admin; full exact WAC fragments after failed to (never truncated cite lists)',
    case_id: '2026-DEMO-05',
    ...META,
    selected_wacs: [
      'WAC 246-341-0640',
      'WAC 246-341-0600',
      'WAC 246-341-0410',
      'WAC 246-341-0420',
    ],
    complaint: `A complaint alleged that an individual received outpatient behavioral health services for several weeks without a completed clinical assessment and without an individual service plan addressing treatment goals and needed services.

Progress notes allegedly referenced treatment activities that were never tied to an approved individual service plan. The complainant stated the administrator failed to ensure clinical policies requiring timely assessment, service planning, and clinical documentation were followed, and that staffing was inadequate to provide treatment services.`,
  },
  {
    id: 'grievance_rights',
    label: '6 · Rights / grievance + retaliation',
    focus:
      '0605 compose parent+leaf (not retaliate against any: Employee…); 0600 rights; exact WAC only — no see-also shortcuts',
    case_id: '2026-DEMO-06',
    ...META,
    state_licensing_priority: 'A',
    federal_certification_priority: 'Referral - Other',
    selected_wacs: [
      'WAC 246-341-0600',
      'WAC 246-341-0605',
      'WAC 246-341-0420',
      'WAC 246-337-075',
    ],
    complaint: `The complainant alleged that when a patient attempted to file a grievance about staff mistreatment, agency staff discouraged the complaint, failed to provide written information about individual rights, and did not follow the agency complaint process timelines.

The patient reportedly asked for a copy of rights materials and was told to wait. No grievance log entry was created. After an employee of the agency assisted the patient in contacting the department, the employee was retaliated against by the agency provider. The complaint also alleged posted rights were outdated, staff were unfamiliar with the complaint procedure, and the agency did not protect confidentiality of treatment information when communicating about the grievance.`,
  },
  {
    id: 'infection_environment',
    label: '7 · Infection control / environment',
    focus:
      '337-060 list-intro + leaf (developing/develop written policies… for: Management of staff…); exact composed duties',
    case_id: '2026-DEMO-07',
    ...META,
    credential_number: 'BHA.FS.61140903',
    investigation_type: 'On-site Federal Investigation',
    state_licensing_priority: 'C',
    federal_certification_priority: 'Immediate Jeopardy (IJ)',
    selected_wacs: [
      'WAC 246-337-060',
      'WAC 246-337-120',
      'WAC 246-337-146',
      'WAC 246-337-045',
    ],
    complaint: `Infection control breakdown at the RTF: staff worked while sick with a communicable disease in an infectious stage, hand hygiene was not enforced, environmental management was neglected, and resident hygiene routines were missed on multiple shifts.

A complaint alleged unsanitary conditions in a residential treatment facility, including unclean resident bathrooms, soiled linens left in hallways, and failure to isolate a resident with a contagious illness according to infection control procedures.

Staff allegedly lacked personal protective equipment on one weekend shift. Governance was alleged to have failed to ensure infection control policies and environmental cleaning schedules were implemented and monitored. Written policies and procedures for cleaning and disinfection, resident hygiene, and management of staff with a communicable disease were not developed or followed.`,
  },
  {
    id: 'qi_critical_incident',
    label: '8 · Quality improvement / critical incident',
    focus:
      '337-048 QI + 045 governance exact verb-led duties; working-draft Download without requiring evidence first',
    case_id: '2026-DEMO-08',
    ...META,
    state_licensing_priority: 'B',
    federal_certification_priority: 'Non-IJ High',
    selected_wacs: [
      'WAC 246-337-048',
      'WAC 246-341-0410',
      'WAC 246-337-045',
      'WAC 246-341-0420',
    ],
    complaint: `Following a serious resident injury during a behavioral escalation, a complaint alleged the facility did not collect or review quality improvement data on critical incidents, did not implement corrective actions, and did not update policies to prevent recurrence.

The complainant alleged the administrator failed to maintain an internal quality management plan addressing clinical supervision and training of staff, incident response, and monitoring of compliance after substantiated events. Governance also failed to adopt, periodically review, and update policies governing organization and functions of the RTF.`,
  },
  {
    id: 'crisis_outreach',
    label: '9 · Crisis outreach response delay',
    focus:
      '0903 crisis MH + 0410 admin labeled exact duties; Report Edit investigation type appears under IR title',
    case_id: '2026-DEMO-09',
    ...META,
    investigation_type: 'On-site State Investigation',
    selected_wacs: [
      'WAC 246-341-0903',
      'WAC 246-341-0410',
      'WAC 246-341-0600',
      'WAC 246-341-0420',
    ],
    complaint: `A complaint alleged that after a family requested crisis mental health services for an individual in acute distress, the agency delayed outreach for many hours and was not staffed 24 hours a day, seven days a week, with a multidisciplinary team capable of meeting the needs of the individual in crisis.

Callers allegedly were given inconsistent information about response times. The complaint further alleged the agency failed to document outreach and stabilization follow-up, administrative oversight of crisis staffing was inadequate, and individual participant rights information was not provided during the crisis episode.`,
  },
  {
    id: 'otp_dosing',
    label: '10 · Opioid treatment program dosing',
    focus:
      'OTP 1000 exact duty clauses; aligns with SOD OTP sample guidance in policy_guidance/; Federal investigation type',
    case_id: '2026-DEMO-10',
    ...META,
    credential_number: 'BHA.FS.61141015',
    investigation_type: 'On-site Federal Investigation',
    state_licensing_priority: 'A',
    federal_certification_priority: 'Non-IJ Medium',
    selected_wacs: [
      'WAC 246-341-1000',
      'WAC 246-341-0410',
      'WAC 246-341-0420',
      'WAC 246-341-0425',
    ],
    complaint: `A complaint alleged an opioid treatment program dispensed take-home doses inconsistent with the individual's phase of treatment, without required medical director review, and with incomplete individual service record documentation of dosing decisions.

Staff allegedly failed to develop, maintain, and implement policies and procedures for OTP requirements, failed to follow policies for missed doses, and did not document counseling contacts. The complainant stated program administration did not ensure medical director responsibilities, adequate staffing, and individual service record standards were met.`,
  },
  {
    id: 'youth_inpatient_rights',
    label: '11 · Youth inpatient rights / consent',
    focus:
      '1124 clinical-record consent + 0600 + RCW 71.34 exact language; blank IR shell fields for Download',
    case_id: '2026-DEMO-11',
    ...META,
    state_licensing_priority: 'C',
    federal_certification_priority: 'Adminstrative Review/Offsite Investigation',
    selected_wacs: [
      'WAC 246-341-1124',
      'WAC 246-341-0600',
      'WAC 246-341-0410',
      'RCW 71.34.510',
    ],
    complaint: `A complaint alleged that an adolescent admitted for inpatient mental health treatment did not have an attempt to obtain informed consent documented in the clinical record, was not asked whether they wished to involve parents, and was not informed of individual rights in an age-appropriate manner.

Staff allegedly restricted family contact without documenting clinical justification. The complainant further alleged required parental notice regarding the voluntary admission was delayed, and administrator oversight of certified behavioral health treatment services and rights practices was not followed.`,
  },
  {
    id: 'weak_overlap',
    label: '12 · Weak overlap (low confidence)',
    focus:
      'Must stay low-confidence; no invented strong duties, no see-also cite lists, no long run-on allegation lines',
    case_id: '2026-DEMO-12',
    ...META,
    investigation_type: 'Off-site State Investigation',
    state_licensing_priority: 'N/A',
    federal_certification_priority: 'No Action Necessary',
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
