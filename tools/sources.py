"""Federal Register, budget documents and committee rosters.

Federal Register: federalregister.gov API (no key). Budget: CBO's publications RSS and GovInfo's BUDGET collection.
Committee membership: the public-domain congress-legislators dataset (unitedstates.github.io), compiled from the
House and Senate committee rosters.
"""
import datetime as dt
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

from fetch import CACHE, get, get_json

DAY = 20 * 3600
FR = "https://www.federalregister.gov/api/v1/documents.json"
FR_FIELDS = ["title", "type", "abstract", "document_number", "html_url", "pdf_url", "publication_date", "agencies",
             "action", "dates", "comments_close_on", "effective_on", "significant", "regulation_id_numbers",
             "docket_ids", "topics", "excerpts"]
ENERGY_AGENCIES = ["marine-minerals-administration", "ocean-energy-management-bureau",
                   "safety-and-environmental-enforcement-bureau", "interior-department", "land-management-bureau",
                   "geological-survey", "energy-department", "federal-energy-regulatory-commission",
                   "nuclear-regulatory-commission", "pipeline-and-hazardous-materials-safety-administration"]
FR_TERMS = ["offshore", "\"outer continental shelf\"", "\"critical minerals\"", "\"marine minerals\""]
LEGISLATORS = "https://unitedstates.github.io/congress-legislators"


def _fr_query(params, since):
    q = [("per_page", "1000"), ("order", "newest"), ("conditions[publication_date][gte]", since)]
    q += [("fields[]", f) for f in FR_FIELDS] + params
    url = FR + "?" + urllib.parse.urlencode(q)
    docs = []
    while url:
        data = get_json(url, DAY)
        docs += data.get("results", [])
        url = data.get("next_page_url")
    return docs


def federal_register(days=365):
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    docs = {}
    for agency in ENERGY_AGENCIES:
        for d in _fr_query([("conditions[agencies][]", agency)], since):
            docs[d["document_number"]] = d
    for term in FR_TERMS:
        for d in _fr_query([("conditions[term]", term)], since):
            docs.setdefault(d["document_number"], d)
    budget = _fr_query([("conditions[agencies][]", "management-and-budget-office")], since)
    for d in budget:
        docs.setdefault(d["document_number"], d)
    return sorted(docs.values(), key=lambda d: d["publication_date"], reverse=True)


def cbo():
    """CBO's RSS carries only the latest items, so each run adds them to a running history kept in the cache."""
    hist_path = CACHE / "cbo_history.json"
    hist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {}
    root = ET.fromstring(get("https://www.cbo.gov/publications/all/rss.xml", DAY).encode("utf-8"))
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        if not link:
            continue
        desc = re.sub(r"<[^>]+>", " ", item.findtext("description") or "")
        desc = re.sub(r"\s+", " ", desc).strip()
        date = item.findtext("pubDate") or ""
        try:
            date = dt.datetime.strptime(date[:16], "%a, %d %b %Y").date().isoformat()
        except ValueError:
            pass
        hist[link] = {"title": (item.findtext("title") or "").strip(), "url": link, "date": date,
                      "summary": desc[:600], "creator": item.findtext("{http://purl.org/dc/elements/1.1/}creator") or ""}
    hist_path.write_text(json.dumps(hist, indent=1), encoding="utf-8")
    return sorted(hist.values(), key=lambda d: d["date"], reverse=True)


def budget_documents(since="2026-01-01"):
    """President's budget volumes (GovInfo BUDGET collection) published since the given date."""
    out, url = [], f"https://api.govinfo.gov/collections/BUDGET/{since}T00:00:00Z?pageSize=100&offsetMark=*"
    while url:
        data = get_json(url, DAY)
        out += data.get("packages", [])
        nxt = data.get("nextPage")
        url = re.sub(r"[&?]api_key=[^&]*", "", nxt) if nxt else None
    docs = []
    for p in out:
        pid = p.get("packageId", "")
        docs.append({"id": pid, "title": p.get("title", ""), "date": p.get("dateIssued", ""),
                     "url": f"https://www.govinfo.gov/app/details/{pid}"})
    return sorted(docs, key=lambda d: d["date"], reverse=True)


def committee_rosters():
    import yaml
    committees = yaml.safe_load(get(f"{LEGISLATORS}/committees-current.yaml", 2 * DAY))
    members = yaml.safe_load(get(f"{LEGISLATORS}/committee-membership-current.yaml", 2 * DAY))
    legislators = json.loads(get(f"{LEGISLATORS}/legislators-current.json", 2 * DAY))
    return committees, members, legislators
