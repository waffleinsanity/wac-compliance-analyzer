"""Verify PDF-primary investigation report generation (IR template shape)."""
import json
import re
import urllib.request

BASE = "http://127.0.0.1:8000"


def post(path, data):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)


health = get("/api/health")
print(
    "health",
    health.get("wac_codes"),
    "codes",
    health.get("template_examples"),
    "examples",
    health.get("template_allegations"),
    "allegations",
)
assert health.get("ready"), "WAC store not ready"
assert health.get("wac_codes", 0) >= 100, "Expected ingested WAC codes"

templates = get("/api/templates")
print("templates codes covered:", len(templates.get("codes_covered", [])))

# Assault-style complaint (Example 1 theme)
assault = post(
    "/api/investigate",
    {
        "text": "It was alleged that a patient was sexually assaulted by another patient while residing at the facility.",
        "selected_wacs": [
            "WAC 246-341-0410",
            "WAC 246-341-0420",
            "WAC 246-341-0600",
            "WAC 246-337-065",
            "WAC 246-337-080",
        ],
        "case_id": "2020-TEST",
        "investigation_date": "07/10/2026",
        "facility_address": "Test Facility",
        "credential_number": "BH-0001",
    },
)

assert assault["case_id"] == "2020-TEST"
assert "It was alleged" in assault["intake_details"] or "alleged" in assault["intake_details"].lower()
assert assault["authority_statement"], "Missing authority statement"
assert "unless concrete evidence" in assault["authority_statement"].lower()
assert len(assault["regulatory_framework"]) == 5
assert len(assault["evidentiary_examples"]) == 5
assert len(assault["allegations"]) == 5

report_text = assault["report_text"]
assert "Regulatory Framework" in report_text
assert "Evidentiary Framework" in report_text
assert "Investigative Report" in report_text

for a in assault["allegations"]:
    assert a["allegation_text"].startswith("Potential violation of WAC"), a["allegation_text"][:80]
    assert "by having failed to" in a["allegation_text"] or "by failing to" in a["allegation_text"]
    # PDF-primary: matched subsections should be present when store has hierarchy
    print("-", a["wac_code"], "subs=", a.get("matched_subsections"), a["allegation_text"][:120], "...")

# Confidentiality-style complaint (Examples 2–5 theme)
conf = post(
    "/api/investigate",
    {
        "text": (
            "Respondent is alleged to have disclosed protected health information on the patient "
            "(18 years old) to the patient's parent, without consent of the patient."
        ),
        "selected_wacs": [
            "WAC 246-341-0420",
            "WAC 246-341-0425",
            "WAC 246-341-0600",
        ],
        "case_id": "CONF-TEST",
    },
)

assert len(conf["evidentiary_examples"]) == 5
assert len(conf["regulatory_framework"]) == 3
assert "Respondent is alleged" in conf["intake_details"] or "alleged" in conf["intake_details"].lower()
# At least one allegation should cite a subsection-style label when matching succeeds
joined = " ".join(a["allegation_text"] for a in conf["allegations"])
assert "Potential violation of WAC" in joined
assert re.search(r"\([0-9a-z]+\)", joined) or any(a.get("matched_subsections") for a in conf["allegations"])
print("confidentiality allegations ok;", len(conf["allegations"]), "items")
print("OK: verify_report_templates passed")
