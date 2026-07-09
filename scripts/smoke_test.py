import json
import re
import urllib.request


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.load(r)


def post(url, data, headers=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


h = get("http://127.0.0.1:8000/api/health")
print("health", h)
wacs = get("http://127.0.0.1:8000/api/wacs?level=code")
print("wacs", len(wacs))
ex = get("http://127.0.0.1:8000/api/examples/Example%201.docx/text")
print("example chars", len(ex["text"]))
mentioned = sorted(set(re.findall(r"246-(?:341|337)-\d{3,4}", ex["text"])) )
selected = [f"WAC {c}" for c in mentioned]
print("selected", selected)
res = post(
    "http://127.0.0.1:8000/api/analyze",
    {
        "text": ex["text"],
        "selected_wacs": selected,
        "include_informational": True,
    },
)
print("findings", len(res["findings"]), "ms", res["duration_ms"])
for f in res["findings"]:
    conf = int(f["confidence"] * 100)
    print("-", f["status"], f["wac_reference"], f"{conf}%", f["template"])
    print(" ", f["formatted_output"][:200].replace("\n", " "), "...")

# Auth smoke test
reg = post(
    "http://127.0.0.1:8000/api/auth/register",
    {"username": "demo_user", "password": "demo1234", "email": "demo@example.com"},
)
print("registered", reg["username"])
token = reg["access_token"]
trig = post(
    "http://127.0.0.1:8000/api/triggers",
    {"wac_id": "WAC 246-341-0420", "phrase": "policies and procedures must address licensing"},
    headers={"Authorization": f"Bearer {token}"},
)
print("trigger", trig)
stats = get("http://127.0.0.1:8000/api/stats")
print("stats analyses", stats["total_analyses"], "codes", stats["total_wac_codes"])
