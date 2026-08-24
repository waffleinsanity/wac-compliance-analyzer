/**
 * Demo evidence packs for admin Intake demos.
 * Synthetic facility records only (no Cat 3/4 PII). Uploaded as .txt when a demo case is saved.
 */
import type { CaseEvidence, EvidenceReviewHit, InvestigationReport } from '../api'
import type { LocalDemoScenario } from './localQuickDraft'
import {
  displayEvidenceTitle,
  extractDocumentDate,
  formatDocumentDate,
  isExhibitProcessLine,
  mergeDocumentReviewLines,
} from '../documentReviewFormat'
import { mergeEvidenceIntoSummary, linkEvidenceHitsToSod } from '../summaryFindingsFormat'

export type DemoEvidenceSpec = {
  title: string
  filename: string
  body: string
  linked_wac_ids?: string[]
}

function datedPolicy(title: string, paragraphs: string[]): string {
  return [
    title,
    'Effective date: July 15, 2026',
    'Facility: Demo Behavioral Health Way program',
    '',
    ...paragraphs,
    '',
    'End of document.',
  ].join('\n')
}

function datedNote(title: string, paragraphs: string[]): string {
  return [
    title,
    'Document date: July 28, 2026',
    'Author: Staff Member A, Shift Lead',
    '',
    ...paragraphs,
    '',
    'End of note.',
  ].join('\n')
}

/** Two to three short exhibits tailored to each demo scenario. */
export function demoEvidenceForScenario(demo: LocalDemoScenario): DemoEvidenceSpec[] {
  const wacs = [...demo.selected_wacs]
  const primary = wacs.slice(0, 2)

  switch (demo.id) {
    case 'assault_safety':
      return [
        {
          title: 'Patient Safety and Supervision Policy',
          filename: 'patient_safety_supervision_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Patient Safety and Supervision Policy', [
            'The administrator is responsible for the day-to-day operation of the agency provision of certified behavioral health treatment services and for protecting patient safety and security on the unit.',
            'Staff must increase supervision when informed of escalating conflict between patients and must separate patients promptly after an alleged assault.',
            'Incidents of patient-to-patient assault or sexual harassment must be documented and escalated according to agency procedure within one hour.',
          ]),
        },
        {
          title: 'Unit Incident Timeline July 2026',
          filename: 'unit_incident_timeline.txt',
          linked_wac_ids: primary,
          body: datedNote('Unit Incident Timeline', [
            'Staff were informed of escalating conflict between two patients on the afternoon shift.',
            'Supervision on the unit was described as intermittent. Separation of the patients was delayed after the reported assault.',
            'Documentation of the event in the individual service record was incomplete at the time of review.',
          ]),
        },
      ]
    case 'confidentiality_phi':
      return [
        {
          title: 'Confidentiality and Disclosure Policy',
          filename: 'confidentiality_disclosure_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Confidentiality and Disclosure Policy', [
            'Protected health information may be shared only with written patient consent or as otherwise authorized by law.',
            'Staff must not disclose diagnosis, medication, or treatment appointment details to family members without authorization.',
            'Each disclosure must be recorded in the individual service record system.',
          ]),
        },
        {
          title: 'Phone Disclosure Log Excerpt',
          filename: 'phone_disclosure_log.txt',
          linked_wac_ids: primary,
          body: datedNote('Phone Disclosure Log Excerpt', [
            'A staff member shared clinical details during a phone call with a parent.',
            'The individual service record did not contain a consent for family involvement covering that disclosure.',
            'Agency policies on when clinical information may be shared were not located in the personnel orientation packet reviewed.',
          ]),
        },
      ]
    case 'restraint_seclusion':
      return [
        {
          title: 'Restraint and Seclusion Procedure',
          filename: 'restraint_seclusion_procedure.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Restraint and Seclusion Procedure', [
            'Seclusion requires timely physician authorization and continuous monitoring documentation.',
            'Physical holds used before seclusion must follow approved de-escalation training.',
            'Residents must be informed of rights related to restraint and seclusion.',
          ]),
        },
        {
          title: 'Seclusion Monitoring Log',
          filename: 'seclusion_monitoring_log.txt',
          linked_wac_ids: primary,
          body: datedNote('Seclusion Monitoring Log', [
            'A resident was placed in seclusion for several hours after a verbal altercation.',
            'Physician authorization timestamps were missing for part of the episode.',
            'Continuous monitoring entries were incomplete for multiple intervals.',
          ]),
        },
        {
          title: 'Governance Policy Review Checklist',
          filename: 'governance_policy_review.txt',
          linked_wac_ids: ['WAC 246-337-045'],
          body: datedPolicy('Governance Policy Review Checklist', [
            'Adopted policies must be periodically reviewed and updated.',
            'Personnel systems must track qualifications and supervision of clinical staff who provide direct resident care.',
            'Communication and conflict-resolution processes for staff and residents must be documented.',
          ]),
        },
      ]
    case 'medication_errors':
      return [
        {
          title: 'Medication Administration Policy',
          filename: 'medication_administration_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Medication Administration Policy', [
            'Staff must document medication administration accurately and report medication errors, adverse effects, and side effects.',
            'Controlled medications must remain locked. Prescribing and administering drugs procedures must be followed.',
            'A prescriber must be notified after an adverse reaction.',
          ]),
        },
        {
          title: 'MAR Exception Report July 2026',
          filename: 'mar_exception_report.txt',
          linked_wac_ids: primary,
          body: datedNote('Medication Administration Record Exception Report', [
            'Missed evening doses and a wrong-dose administration of a psychiatric medication were recorded.',
            'Controlled medications were found unlocked on one shift according to the shift handoff note.',
            'Supervision of medication-trained personnel was described as inadequate during the reviewed week.',
          ]),
        },
      ]
    case 'assessment_isp':
      return [
        {
          title: 'Clinical Assessment and ISP Policy',
          filename: 'assessment_isp_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Clinical Assessment and Individual Service Plan Policy', [
            'A clinical assessment and individual service plan addressing treatment goals must be completed timely.',
            'Progress notes must be tied to an approved individual service plan.',
            'The administrator must ensure clinical policies requiring assessment, service planning, and clinical documentation are followed.',
          ]),
        },
        {
          title: 'Chart Audit Worksheet',
          filename: 'chart_audit_worksheet.txt',
          linked_wac_ids: primary,
          body: datedNote('Chart Audit Worksheet', [
            'An individual received outpatient services for several weeks without a completed clinical assessment.',
            'Progress notes referenced treatment activities not linked to an approved individual service plan.',
            'Staffing notes indicated insufficient capacity to complete assessments on schedule.',
          ]),
        },
      ]
    case 'grievance_rights':
      return [
        {
          title: 'Individual Rights and Grievance Policy',
          filename: 'rights_grievance_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Individual Rights and Grievance Policy', [
            'The agency must not retaliate against any employee of the agency or individual for filing a grievance.',
            'Individuals must receive rights information and access to the grievance process.',
            'Grievance responses must be documented in the individual service record.',
          ]),
        },
        {
          title: 'Grievance File Summary',
          filename: 'grievance_file_summary.txt',
          linked_wac_ids: primary,
          body: datedNote('Grievance File Summary', [
            'A grievance alleging rights concerns was filed. Follow-up interviews described fear of retaliation after the filing.',
            'Rights materials were not present in the admission packet reviewed for the episode.',
            'Administrator oversight notes did not document monitoring of grievance timelines.',
          ]),
        },
      ]
    case 'infection_environment':
      return [
        {
          title: 'Infection Prevention Policy',
          filename: 'infection_prevention_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Infection Prevention Policy', [
            'The residential treatment facility must develop written policies and procedures for management of staff with a communicable disease in an infectious stage, cleaning and disinfection, and resident hygiene.',
            'Hand hygiene must be enforced. Environmental management and isolation when indicated must be implemented.',
            'Personal protective equipment supplies must be available on all shifts.',
          ]),
        },
        {
          title: 'Environmental Cleaning and Outbreak Log',
          filename: 'environmental_outbreak_log.txt',
          linked_wac_ids: primary,
          body: datedNote('Environmental Cleaning and Outbreak Log', [
            'Unsanitary conditions were noted in resident bathrooms and soiled linens were left in hallways.',
            'A resident with a contagious illness was not isolated according to infection control procedures.',
            'Staff worked while sick with a communicable disease. PPE was unavailable on one weekend shift.',
          ]),
        },
      ]
    case 'qi_critical_incident':
      return [
        {
          title: 'Quality Improvement Plan',
          filename: 'quality_improvement_plan.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Internal Quality Management Plan', [
            'The facility must collect and review quality improvement data on critical incidents.',
            'Corrective actions must be implemented and policies updated to prevent recurrence.',
            'The administrator must maintain an internal quality management plan addressing clinical supervision, training, and incident response.',
          ]),
        },
        {
          title: 'Critical Incident Review Minutes',
          filename: 'critical_incident_review.txt',
          linked_wac_ids: primary,
          body: datedNote('Critical Incident Review Minutes', [
            'Following a serious resident injury during a behavioral escalation, quality improvement data on the incident was not reviewed in committee.',
            'Corrective actions were not assigned owners or due dates.',
            'Governance notes did not show periodic review of policies governing organization and functions of the RTF.',
          ]),
        },
      ]
    case 'crisis_outreach':
      return [
        {
          title: 'Crisis Outreach Protocol',
          filename: 'crisis_outreach_protocol.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Crisis Mental Health Outreach Protocol', [
            'Crisis services must be staffed to meet the needs of the individual in crisis, including capacity for timely outreach.',
            'Outreach and stabilization follow-up must be documented.',
            'Individual participant rights information must be provided during the crisis episode.',
          ]),
        },
        {
          title: 'Crisis Call Response Log',
          filename: 'crisis_call_response_log.txt',
          linked_wac_ids: primary,
          body: datedNote('Crisis Call Response Log', [
            'A family requested crisis mental health services for an individual in acute distress.',
            'Outreach was delayed for many hours. Callers received inconsistent information about response times.',
            'Documentation of outreach and stabilization follow-up was missing for the episode.',
          ]),
        },
      ]
    case 'otp_dosing':
      return [
        {
          title: 'OTP Dosing and Take-Home Policy',
          filename: 'otp_dosing_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Opioid Treatment Program Dosing Policy', [
            'Take-home doses must be consistent with the individual phase of treatment and require medical director review when indicated.',
            'The program must develop, maintain, and implement policies for OTP requirements and missed doses.',
            'Counseling contacts and dosing decisions must be documented in the individual service record.',
          ]),
        },
        {
          title: 'Dosing Exception Audit',
          filename: 'dosing_exception_audit.txt',
          linked_wac_ids: primary,
          body: datedNote('Dosing Exception Audit', [
            'Take-home doses inconsistent with phase of treatment were identified on chart review.',
            'Medical director review documentation was incomplete for several dosing decisions.',
            'Missed-dose procedures were not followed according to the nursing shift notes reviewed.',
          ]),
        },
      ]
    case 'youth_inpatient_rights':
      return [
        {
          title: 'Youth Admission Consent Policy',
          filename: 'youth_admission_consent_policy.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Youth Inpatient Admission and Consent Policy', [
            'An attempt to obtain informed consent must be documented in the clinical record.',
            'Youth must be asked whether they wish to involve parents and informed of individual rights in an age-appropriate manner.',
            'Parental notice regarding voluntary admission must be provided within required timelines.',
          ]),
        },
        {
          title: 'Admission Chart Checklist',
          filename: 'admission_chart_checklist.txt',
          linked_wac_ids: primary,
          body: datedNote('Admission Chart Checklist', [
            'Informed consent attempt was not documented in the clinical record for the adolescent admission reviewed.',
            'Family contact restrictions lacked documented clinical justification.',
            'Rights education materials appropriate to age were not present in the admission packet.',
          ]),
        },
      ]
    case 'weak_overlap':
      return [
        {
          title: 'Amenities Feedback Form',
          filename: 'amenities_feedback_form.txt',
          linked_wac_ids: primary,
          body: datedNote('Amenities Feedback Form', [
            'Complainant expressed dissatisfaction with cafeteria menu options, parking availability, and waiting-room chair color.',
            'No clinical safety, rights, treatment, or privacy concerns were described.',
            'This record is retained only to document the amenity feedback received.',
          ]),
        },
        {
          title: 'Facility Welcome Brochure Excerpt',
          filename: 'welcome_brochure_excerpt.txt',
          linked_wac_ids: primary,
          body: datedPolicy('Facility Welcome Brochure Excerpt', [
            'The program describes visitor parking, cafeteria hours, and lobby furnishings.',
            'No clinical protocols are included in this excerpt.',
          ]),
        },
      ]
    default:
      return [
        {
          title: 'Facility Policy Excerpt',
          filename: `${demo.id}_policy.txt`,
          linked_wac_ids: primary,
          body: datedPolicy(`Facility Policy Excerpt (${demo.label})`, [
            'This assistive demo exhibit summarizes agency expectations related to the selected Washington codes.',
            `Approved codes for this demo case: ${wacs.join(', ') || 'none'}.`,
            'Investigators should replace demo exhibits with case-specific records before finalize.',
          ]),
        },
        {
          title: 'Record Review Note',
          filename: `${demo.id}_record_review.txt`,
          linked_wac_ids: primary,
          body: datedNote(`Record Review Note (${demo.case_id})`, [
            'Demo exhibit attached so Evidence Log ordinals and Document Review superscripts can be exercised.',
            'No Category 3 or 4 identifiers are included in this synthetic note.',
          ]),
        },
      ]
  }
}

export function demoEvidenceFile(spec: DemoEvidenceSpec): File {
  return new File([spec.body], spec.filename, { type: 'text/plain' })
}

function citeKey(value: string): string {
  return (value || '').toLowerCase().replace(/\s+/g, '').replace(/wac/g, '').replace(/rcw/g, '')
}

/**
 * Merge demo exhibits into IR Document Review (with superscripts) and link SOD findings
 * so Evidence Log ordinals and export superscripts work without a manual Evidence continue.
 * When duty-RAG hits are provided, Summary / SOD Findings included use peer showed phrasing.
 */
export function applyDemoEvidenceToReport(
  report: InvestigationReport,
  evidence: CaseEvidence[],
  demo: LocalDemoScenario,
  evidenceHits?: EvidenceReviewHit[],
): InvestigationReport {
  const specs = demoEvidenceForScenario(demo)
  if (!evidence.length) return report

  const includedHits = (evidenceHits || []).filter(
    (h) => h.included_by_default !== false && (h.excerpt || '').trim(),
  )

  const documents = evidence.map((ev) => {
    const spec =
      specs.find((s) => s.title === ev.title) ||
      specs.find((s) => s.filename === ev.original_filename) ||
      null
    const dated =
      extractDocumentDate(spec?.body || '') ||
      formatDocumentDate(ev.created_at || '') ||
      'July 15, 2026'
    const hitExcerpt =
      includedHits.find((h) => h.evidence_id === ev.id)?.excerpt || ''
    return {
      title: displayEvidenceTitle(ev.title || ev.original_filename || `document ${ev.id}`),
      documentDate: dated,
      excerpt: hitExcerpt,
      cite: (spec?.linked_wac_ids || ev.linked_wac_ids || [])[0],
      exhibitNumber: ev.exhibit_number ?? null,
      evidenceId: ev.id,
    }
  })

  const investigative_process = mergeDocumentReviewLines(
    report.investigative_process || [],
    documents,
  )

  const summary_of_findings = mergeEvidenceIntoSummary(
    { ...report, investigative_process },
    documents.map((d) => ({ title: d.title, documentDate: d.documentDate, excerpt: d.excerpt })),
    includedHits,
  )

  let sod = report.sod
  if (includedHits.length) {
    sod = linkEvidenceHitsToSod({ ...report, sod }, includedHits) || sod
  } else if (sod?.deficiencies?.length) {
    const deficiencies = sod.deficiencies.map((d) => {
      const findings = [...(d.findings || [])]
      const reg = citeKey(d.regulation_cite || '')
      for (const ev of evidence) {
        const links = (
          ev.linked_wac_ids?.length
            ? ev.linked_wac_ids
            : specs.find((s) => s.title === ev.title)?.linked_wac_ids || []
        ).map(String)
        if (links.length && reg) {
          const ok = links.some((w) => {
            const k = citeKey(w)
            return Boolean(k && (reg.includes(k) || k.includes(reg)))
          })
          if (!ok) continue
        }
        const eid = String(ev.id)
        if (findings.some((f) => (f.evidence_ids || []).includes(eid))) continue
        const title = displayEvidenceTitle(ev.title || ev.original_filename || `document ${ev.id}`)
        findings.push({
          method: 'document review',
          text: `Review of the document titled, "${title}", showed the record was reviewed.`,
          evidence_ids: [eid],
        })
      }
      return { ...d, findings }
    })
    sod = { ...sod, deficiencies }
  }

  const evidenceLogRows = evidence.map((ev, i) => {
    const spec =
      specs.find((s) => s.title === ev.title) ||
      specs.find((s) => s.filename === ev.original_filename) ||
      null
    const datedRaw =
      extractDocumentDate(spec?.body || '') || formatDocumentDate(ev.created_at || '') || ''
    // Prefer MM-DD-YY for Evidence Log column C.
    let dateCollected = ''
    const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i.exec(
      datedRaw,
    )
    if (named) {
      const months = [
        'january','february','march','april','may','june','july','august','september','october','november','december',
      ]
      const mi = months.indexOf(named[1].toLowerCase()) + 1
      dateCollected = `${String(mi).padStart(2, '0')}-${String(named[2]).padStart(2, '0')}-${String(named[3]).slice(-2)}`
    }
    const wacs = [...(spec?.linked_wac_ids || ev.linked_wac_ids || [])]
    while (wacs.length < 4) wacs.push('')
    return {
      exhibit_number: ev.exhibit_number || i + 1,
      description: displayEvidenceTitle(ev.title || ev.original_filename || `document ${ev.id}`),
      date_collected: dateCollected || '07-15-26',
      collected_by: '',
      method: 'Electronic upload',
      electronic_location: '',
      wac_codes: wacs.slice(0, 4),
      evidence_id: ev.id,
    }
  })

  return {
    ...report,
    investigative_process,
    summary_of_findings,
    sod,
    evidence_review: evidenceHits !== undefined ? evidenceHits : report.evidence_review,
    evidence_log: {
      investigator_name: '',
      case_numbers: demo.case_id,
      license_numbers: demo.credential_number,
      facility_name: (demo.facility_address || '').split('\n')[0] || '',
      rows: evidenceLogRows,
    },
  }
}

/** True when a DEMO case has exhibits but Document Review / Summary still need wiring. */
export function demoEvidenceNeedsWire(
  report: InvestigationReport | null | undefined,
  evidence: CaseEvidence[] | undefined,
): boolean {
  if (!evidence?.length || !report) return false
  const process = report.investigative_process || []
  const hasReviewLines = process.some((line) => isExhibitProcessLine(line))
  if (!hasReviewLines) return true
  const summary = report.summary_of_findings || ''
  if (/A review of the document titled/i.test(summary)) return false
  // Duty RAG already attempted for this draft.
  return !Array.isArray(report.evidence_review)
}
