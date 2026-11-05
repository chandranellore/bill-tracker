"""Builds the Bill Tracker data files under docs/data from the source loaders.

Usage: py -3.12 build.py [--cached-only]
--cached-only skips any focus bill whose detail is not in the cache yet (used while load_bills.py is still running).
"""
import datetime as dt
import html
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import congress
import fetch
import sources
import votes as V
from digest import build_digests

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DATA = DOCS / "data"
CACHED_ONLY = "--cached-only" in sys.argv
TEXT_MAX = 3_000_000
SUBCOMMITTEES = [
    ("Agriculture", r"Agriculture"), ("Commerce, Justice, Science", r"Commerce, Justice"), ("Defense", r"Department of Defense|^Defense|for the Department of Defense"),
    ("Energy and Water", r"Energy and Water"), ("Financial Services", r"Financial Services"),
    ("Homeland Security", r"Homeland Security"), ("Interior and Environment", r"Interior, Environment"),
    ("Labor, HHS, Education", r"Labor, Health"), ("Legislative Branch", r"Legislative Branch"),
    ("Military Construction, VA", r"Military Construction"), ("National Security, State", r"State, Foreign|National Security, Department of State|Department of State"),
    ("Transportation, HUD", r"Transportation, and Housing|Transportation, Housing"),
]
STAGES = ["Introduced", "In committee", "Reported", "Passed one chamber", "Passed both chambers", "To President", "Law"]


def write(name, obj):
    path = DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return path


def bill_id(btype, number):
    return f"{btype.lower()}{number}"


def clean_summary(text):
    """CRS summaries are simple HTML. Keep paragraphs, lists and emphasis; drop everything else."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", text or "")
    text = re.sub(r"(?i)<(/?)(p|ul|ol|li|strong|em|b|i)(\s[^>]*)?>", r"[[\1\2]]", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.escape(html.unescape(text), quote=False)
    return re.sub(r"\[\[(/?)(p|ul|ol|li|strong|em|b|i)\]\]", r"<\1\2>", text)


def plain(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def stage(actions, bill):
    texts = " | ".join(a.get("text", "") for a in actions)
    codes = {a.get("actionCode", "") for a in actions}
    if bill.get("laws") or re.search(r"Became Public Law|Became Private Law", texts):
        return 6
    if re.search(r"Presented to President|Vetoed|Pocket Vetoed", texts):
        return 5
    passed_h = bool(re.search(r"Passed House|passed House|Passed/agreed to in House|agreed to in House", texts)) or "8000" in codes
    passed_s = bool(re.search(r"Passed Senate|passed Senate|Passed/agreed to in Senate|agreed to in Senate", texts)) or "17000" in codes
    if passed_h and passed_s:
        return 4
    if passed_h or passed_s:
        return 3
    if re.search(r"[Rr]eported|Placed on .*Calendar|Ordered to be Reported", texts):
        return 2
    if re.search(r"[Rr]eferred to", texts):
        return 1
    return 0


def version_code(url):
    m = re.search(r"BILLS-\d+[a-z]+\d+([a-z]+)\.htm", url or "")
    return m.group(1) if m else ""


def compact_action(a):
    out = {"d": a.get("actionDate", ""), "t": a.get("text", ""), "k": a.get("type", "")}
    if a.get("actionTime"):
        out["tm"] = a["actionTime"]
    code = (a.get("sourceSystem") or {}).get("name", "")
    out["c"] = "H" if "House" in code else "S" if "Senate" in code else ""
    rv = []
    for v in a.get("recordedVotes") or []:
        rv.append({"ch": v.get("chamber"), "roll": v.get("rollNumber"), "sess": v.get("sessionNumber"),
                   "date": (v.get("date") or "")[:10], "url": v.get("url")})
    if rv:
        out["v"] = rv
    return out


def dedupe_actions(actions):
    """Congress.gov lists some actions twice (once per source system). Keep one of each date and text."""
    seen, out = set(), []
    for a in actions:
        key = (a.get("actionDate"), re.sub(r"^.*?: ", "", a.get("text", "")) if a.get("type") != "President" else a.get("text"))
        if key in seen:
            continue
        seen.add(key)
        out.append(a)
    return out


def bill_record(item, detail, text_dir, want_text):
    b, topics, _ = item
    bill = detail["bill"]
    bid = bill_id(b["type"], b["number"])
    actions = dedupe_actions(detail.get("actions", []))
    sponsors = bill.get("sponsors") or []
    versions = []
    for tv in detail.get("text", []):
        fmt = {f["type"]: f["url"] for f in tv.get("formats", [])}
        htm = fmt.get("Formatted Text")
        code = version_code(htm)
        v = {"type": tv.get("type", ""), "date": (tv.get("date") or "")[:10], "code": code, "htm": htm, "pdf": fmt.get("PDF")}
        if want_text and htm and code:
            path = text_dir / bid / f"{code}.txt"
            try:
                if not path.exists():
                    body = congress.text_body(htm)
                    if len(body) <= TEXT_MAX:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(body, encoding="utf-8")
                if path.exists():
                    v["local"] = f"data/text/{bid}/{code}.txt"
                    v["size"] = path.stat().st_size
            except Exception as e:
                print("text", bid, code, e)
        versions.append(v)
    # Enrolled versions often carry no date: put them after the dated bill versions but before the public law
    versions.sort(key=lambda v: (v["type"] == "Public Law", v["date"] or "9999"))
    summaries = sorted(detail.get("summaries", []), key=lambda s: (s.get("actionDate", ""), s.get("updateDate", "")))
    committees = [{"name": c.get("name"), "chamber": c.get("chamber"), "code": c.get("systemCode"),
                   "acts": [{"d": (x.get("date") or "")[:10], "n": x.get("name")} for x in c.get("activities", [])],
                   "subs": [{"name": s.get("name"), "code": s.get("systemCode"),
                             "acts": [{"d": (x.get("date") or "")[:10], "n": x.get("name")} for x in s.get("activities", [])]}
                            for s in c.get("subcommittees", [])]}
                  for c in detail.get("committees", [])]
    amendments = [{"num": f'{a.get("type", "")} {a.get("number", "")}', "type": a.get("type"), "number": a.get("number"),
                   "desc": a.get("description") or a.get("purpose") or "", "purpose": a.get("purpose") or "",
                   "la": a.get("latestAction") or {}}
                  for a in detail.get("amendments", [])]
    rec = {
        "id": bid, "type": b["type"], "number": b["number"], "congress": congress.CONGRESS,
        "title": bill.get("title", b["title"]), "introduced": bill.get("introducedDate", ""),
        "chamber": bill.get("originChamber", ""), "policy": (bill.get("policyArea") or {}).get("name", ""),
        "sponsor": [{"id": s.get("bioguideId"), "name": s.get("fullName"), "party": s.get("party"), "state": s.get("state")}
                    for s in sponsors],
        "cosponsors": (bill.get("cosponsors") or {}).get("count", 0),
        "la": bill.get("latestAction") or {}, "topics": sorted(topics), "stage": stage(actions, bill),
        "actions": [compact_action(a) for a in actions], "committees": committees, "amendments": amendments,
        "summaries": [{"v": s.get("actionDesc", ""), "d": s.get("actionDate", ""), "html": clean_summary(s.get("text", ""))}
                      for s in summaries],
        "versions": versions,
        "cbo": [{"title": c.get("title"), "date": (c.get("pubDate") or "")[:10], "url": c.get("url"), "desc": plain(c.get("description"))}
                for c in bill.get("cboCostEstimates", [])],
        "reports": [{"citation": r.get("citation")} for r in bill.get("committeeReports", [])],
        "laws": [{"type": l.get("type"), "number": l.get("number")} for l in bill.get("laws", [])],
        "related": [{"id": bill_id(r["type"], r["number"]), "title": r.get("title"), "rel": [x.get("type") for x in r.get("relationshipDetails", [])],
                     "la": r.get("latestAction") or {}} for r in detail.get("relatedbills", []) if r.get("congress") == congress.CONGRESS],
        "updated": b.get("updateDateIncludingText") or b.get("updateDate"),
    }
    return rec


def load_detail(item):
    b, topics, parts = item
    update = b.get("updateDateIncludingText") or b["updateDate"]
    first = f"{congress.API}/bill/{congress.CONGRESS}/{b['type'].lower()}/{b['number']}?format=json&v={update}"
    if CACHED_ONLY and not fetch.cached(first):
        return None
    try:
        return congress.bill_detail(b["type"], b["number"], update, parts)
    except Exception as e:
        print("detail", b["type"], b["number"], e)
        return None


def approps_table(records, fy):
    """FY appropriations status: for each of the 12 regular bills, the furthest House and Senate bills."""
    rows = []
    pat = re.compile(rf"Appropriations Act, {fy}\b|fiscal year ending September 30, {fy}\b", re.I)
    candidates = [r for r in records.values() if pat.search(r["title"]) and r["type"] in ("HR", "S")]
    for label, rx in SUBCOMMITTEES:
        mine = [r for r in candidates if re.search(rx, r["title"], re.I) and not re.search(r"Continuing|Further|Consolidated|Minibus|;", r["title"], re.I)]
        house = max((r for r in mine if r["type"] == "HR"), key=lambda r: (r["stage"], r["la"].get("actionDate", "")), default=None)
        senate = max((r for r in mine if r["type"] == "S"), key=lambda r: (r["stage"], r["la"].get("actionDate", "")), default=None)
        rows.append({"sub": label,
                     "house": house and {"id": house["id"], "label": f"H.R. {house['number']}", "stage": house["stage"], "la": house["la"]},
                     "senate": senate and {"id": senate["id"], "label": f"S. {senate['number']}", "stage": senate["stage"], "la": senate["la"]}})
    omnibus = [r for r in candidates if re.search(r"Continuing|Further|Consolidated|;|and Extensions", r["title"], re.I)]
    cr = [{"id": r["id"], "title": r["title"], "stage": r["stage"], "la": r["la"]}
          for r in sorted(omnibus, key=lambda r: r["la"].get("actionDate", ""), reverse=True)]
    return {"fy": fy, "rows": rows, "combined": cr}


def members_data(bill_recs):
    current, details = congress.members(CACHED_ONLY)
    committees, rosters, legislators = sources.committee_rosters()
    leg = {l["id"]["bioguide"]: l for l in legislators}
    names = {}
    for c in committees:
        names[c["thomas_id"]] = {"name": c["name"], "chamber": c["type"]}
        for s in c.get("subcommittees", []):
            names[c["thomas_id"] + s["thomas_id"]] = {"name": s["name"], "parent": c["thomas_id"], "chamber": c["type"]}
    assign = defaultdict(list)
    for code, roster in rosters.items():
        for m in roster or []:
            assign[m["bioguide"]].append({"code": code, "name": (names.get(code) or {}).get("name", code),
                                          "parent": (names.get(code) or {}).get("parent"),
                                          "title": m.get("title", ""), "rank": m.get("rank"), "side": m.get("party")})
    sponsored = defaultdict(list)
    for r in bill_recs.values():
        for s in r["sponsor"]:
            sponsored[s["id"]].append(r["id"])
    out = []
    for m, d in zip(current, details):
        bio = m["bioguideId"]
        l = leg.get(bio, {})
        terms = d.get("terms") or []
        last = terms[-1] if terms else {}
        lterm = (l.get("terms") or [{}])[-1]
        chamber = "Senate" if "Senate" in (last.get("chamber") or "") else "House"
        try:
            spons = congress.sponsored(bio) if not CACHED_ONLY or fetch.cached(
                f"{congress.API}/member/{bio}/sponsored-legislation?format=json&limit=20") else []
        except Exception as e:
            print("sponsored", bio, e)
            spons = []
        out.append({
            "id": bio, "name": d.get("directOrderName") or m.get("name"), "last": d.get("lastName", ""),
            "first": d.get("firstName", ""), "party": (d.get("partyHistory") or [{}])[-1].get("partyName", m.get("partyName", "")),
            "state": d.get("state", m.get("state", "")), "district": last.get("district") if chamber == "House" else None,
            "chamber": chamber, "born": d.get("birthYear") or (l.get("bio") or {}).get("birthday", "")[:4],
            "gender": (l.get("bio") or {}).get("gender", ""), "photo": (d.get("depiction") or {}).get("imageUrl", ""),
            "photoCredit": (d.get("depiction") or {}).get("attribution", ""),
            "office": (d.get("addressInformation") or {}).get("officeAddress", "") or lterm.get("address", ""),
            "phone": (d.get("addressInformation") or {}).get("phoneNumber", "") or lterm.get("phone", ""),
            "web": d.get("officialWebsiteUrl") or lterm.get("url", ""), "contact": lterm.get("contact_form", ""),
            "class": lterm.get("class"), "termEnd": lterm.get("end", ""), "stateRank": lterm.get("state_rank", ""),
            "leadership": [x.get("type") for x in d.get("leadership", []) if x.get("current")],
            "terms": [{"ch": t.get("chamber"), "start": t.get("startYear"), "end": t.get("endYear"), "st": t.get("stateCode"),
                       "dist": t.get("district")} for t in terms],
            "committees": sorted(assign.get(bio, []), key=lambda c: (c["parent"] is not None, c["name"])),
            "sponsoredCount": (d.get("sponsoredLegislation") or {}).get("count", 0),
            "cosponsoredCount": (d.get("cosponsoredLegislation") or {}).get("count", 0),
            "sponsored": [{"id": bill_id(s["type"], s["number"]) if s.get("type") else "", "type": s.get("type"), "number": s.get("number"),
                           "title": s.get("title") or (s.get("amendmentNumber") and f"Amendment {s['amendmentNumber']}") or "",
                           "date": s.get("introducedDate", ""), "la": s.get("latestAction") or {}}
                          for s in spons if s.get("congress") == congress.CONGRESS][:20],
            "ids": {k: l.get("id", {}).get(k) for k in ("lis", "icpsr", "govtrack") if l.get("id", {}).get(k)},
        })
    out.sort(key=lambda m: (m["chamber"], m["state"], m.get("district") or 0, m["last"]))
    comm = {code: v for code, v in names.items()}
    return out, comm


def vote_data(bill_recs):
    house = V.house_votes(congress.house_vote_list())
    house.sort(key=lambda v: (v["year"], v["roll"]), reverse=True)
    senate = V.senate_voteview()
    # Same-day Senate tallies from Congress.gov bill actions, for votes Voteview has not published yet
    vv = {(v["session"], v["clerk_roll"]): v for v in senate}
    from_actions = {}
    for r in bill_recs.values():
        for a in r["actions"]:
            for v in a.get("v", []):
                if v["ch"] == "Senate":
                    m = re.search(r"(\d+)\s*-\s*(\d+)", a["t"])
                    key = (str(v["sess"]), str(v["roll"]))
                    from_actions.setdefault(key, {"chamber": "Senate", "session": v["sess"], "roll": v["roll"], "date": v["date"],
                                                  "bill": r["id"], "text": a["t"], "url": v["url"],
                                                  "yea": int(m.group(1)) if m else None, "nay": int(m.group(2)) if m else None})
    positions = {"House": {}, "Senate": {}}
    hsum = []
    for v in house:
        key = f"{v['year']}-{v['roll']}"
        positions["House"][key] = v.pop("positions")
        v["key"] = key
        hsum.append(v)
    ssum = []
    for v in senate:
        key = f"{v['session']}-{v['clerk_roll']}"
        positions["Senate"][key] = v.pop("positions")
        v["key"] = key
        a = from_actions.get((str(v["session"]), str(v["clerk_roll"])))
        if a:
            v["bill"], v["url"] = a["bill"], a["url"]
        ssum.append(v)
    pending = [a for k, a in from_actions.items() if k not in vv]
    for a in pending:
        a["key"] = f"{a['session']}-{a['roll']}"
        a["pending"] = True
    ssum = sorted(ssum + pending, key=lambda v: (str(v["date"]), int(v.get("clerk_roll") or v.get("roll") or 0)), reverse=True)
    # Compact positions: one string per vote over a fixed member order, so member pages can show a voting record
    packed = {}
    for ch, rolls in positions.items():
        order = sorted({b for p in rolls.values() for b in p})
        idx = {b: i for i, b in enumerate(order)}
        packed[ch] = {"members": order, "rolls": {k: "".join(p.get(b, "-") for b in order) for k, p in rolls.items()}}
        del idx
    return hsum, ssum, packed


def fr_data():
    docs = sources.federal_register()
    out = []
    for d in docs:
        text = " ".join([d.get("title") or "", d.get("abstract") or ""])
        topics = []
        slugs = [a.get("slug") for a in d.get("agencies", []) if a.get("slug")]
        if congress.FR_OFFSHORE.search(text) or any(s in slugs for s in ("marine-minerals-administration", "ocean-energy-management-bureau", "safety-and-environmental-enforcement-bureau")):
            topics.append("offshore")
        out.append({"id": d["document_number"], "title": d.get("title") or "", "type": d.get("type") or "",
                    "abstract": (d.get("abstract") or "")[:500], "date": d.get("publication_date"), "url": d.get("html_url"),
                    "pdf": d.get("pdf_url"), "agencies": [a.get("name") or a.get("raw_name") for a in d.get("agencies", [])],
                    "slugs": slugs, "action": d.get("action") or "", "comments": d.get("comments_close_on"),
                    "effective": d.get("effective_on"), "sig": bool(d.get("significant")), "rin": d.get("regulation_id_numbers") or [],
                    "docket": d.get("docket_ids") or [], "topics": topics})
    return out


def changes_feed(bill_list, bill_recs, hvotes, svotes, fr, cbo, days=45):
    """Every dated event of the last 45 days, for alerts, the activity view and digests."""
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    ev = []
    for b in bill_list:
        bid = bill_id(b["type"], b["number"])
        rec = bill_recs.get(bid)
        if rec:
            for a in rec["actions"]:
                if a["d"] >= since:
                    ev.append({"d": a["d"], "k": "action", "id": bid, "t": a["t"], "c": a["c"]})
        else:
            la = congress.latest(b)
            if (la.get("actionDate") or "") >= since:
                ev.append({"d": la["actionDate"], "k": "action", "id": bid, "t": la.get("text", "")})
    for v in hvotes:
        d = dt.datetime.strptime(v["date"], "%d-%b-%Y").date().isoformat() if v.get("date") else ""
        if d >= since:
            ev.append({"d": d, "k": "vote", "ch": "House", "key": v["key"], "t": f'{v["question"]}: {v["legis"]} {v["result"]} ({v["yea"]}-{v["nay"]})'})
    for v in svotes:
        if str(v.get("date", "")) >= since:
            ev.append({"d": v["date"], "k": "vote", "ch": "Senate", "key": v["key"],
                       "t": v.get("text") or f'{v.get("question", "")}: {v.get("legis", "")} {v.get("result", "")} ({v.get("yea")}-{v.get("nay")})'})
    for d in fr:
        if d["date"] >= since:
            ev.append({"d": d["date"], "k": "fr", "id": d["id"], "t": d["title"]})
    for c in cbo:
        if c["date"] >= since:
            ev.append({"d": c["date"], "k": "cbo", "url": c["url"], "t": c["title"]})
    ev.sort(key=lambda e: e["d"], reverse=True)
    return ev


def main():
    started = dt.datetime.now(dt.timezone.utc)
    DATA.mkdir(parents=True, exist_ok=True)
    text_dir = DATA / "text"
    bills = congress.bill_list()
    work = congress.focus(bills)
    print(len(bills), "bills;", len(work), "focus", flush=True)
    records = {}
    for item in work:
        detail = load_detail(item)
        if detail:
            b, topics, _ = item
            want_text = bool(topics) or congress.ADVANCED.search(congress.latest(b).get("text", "")) and re.search(
                r"Passed|Became|Presented|Signed|Received in the", congress.latest(b).get("text", ""))
            rec = bill_record(item, detail, text_dir, want_text)
            records[rec["id"]] = rec
    print(len(records), "bill records", fetch.stats, flush=True)
    (DATA / "bill").mkdir(parents=True, exist_ok=True)
    for old in (DATA / "bill").glob("*.json"):
        if old.stem not in records:
            old.unlink()
    for bid, rec in records.items():
        write(f"bill/{bid}.json", rec)
    topics_of = {bill_id(b["type"], b["number"]): t for b, t, _ in work}
    rows = []
    for b in bills:
        bid = bill_id(b["type"], b["number"])
        la = congress.latest(b)
        rec = records.get(bid)
        rows.append([bid, b["type"], b["number"], b["title"], b.get("introducedDate", ""), la.get("actionDate", ""),
                     (la.get("text") or "")[:240], b.get("originChamberCode", ""), "".join(sorted(t[0] for t in topics_of.get(bid, ()))),
                     1 if rec else 0, rec["stage"] if rec else -1, (rec["policy"] if rec else ""),
                     [c["code"] for c in rec["committees"]] if rec else [], rec["sponsor"][0]["id"] if rec and rec["sponsor"] else ""])
    write("bills.json", {"fields": ["id", "type", "number", "title", "introduced", "laDate", "laText", "chamber", "topics",
                                    "detail", "stage", "policy", "committees", "sponsor"], "rows": rows})
    hvotes, svotes, positions = vote_data(records)
    write("votes_house.json", hvotes)
    write("votes_senate.json", svotes)
    write("positions.json", positions)
    print("votes", len(hvotes), len(svotes), flush=True)
    members, comm = members_data(records)
    write("members.json", members)
    write("committees.json", comm)
    print("members", len(members), flush=True)
    fr = fr_data()
    write("fr.json", fr)
    cbo = sources.cbo()
    try:
        budget_docs = sources.budget_documents()
    except Exception as e:
        print("budget docs", e)
        budget_docs = []
    write("budget.json", {"fy2027": approps_table(records, 2027), "fy2026": approps_table(records, 2026), "cbo": cbo,
                          "documents": budget_docs})
    feed = changes_feed(bills, records, hvotes, svotes, fr, cbo)
    write("changes.json", feed)
    digests = build_digests(records, {r[0]: r for r in rows}, feed, fr, cbo, hvotes, svotes, DOCS)
    meta = {"built": started.isoformat(timespec="seconds"), "congress": congress.CONGRESS, "bills": len(bills),
            "tracked": len(records), "houseVotes": len(hvotes), "senateVotes": len(svotes), "members": len(members),
            "fr": len(fr), "latestAction": max((r[5] for r in rows), default=""), "digests": digests,
            "senateVoteviewLatest": max((str(v["date"]) for v in svotes if not v.get("pending")), default=""),
            "stages": STAGES}
    write("meta.json", meta)
    leak = [p for p in DOCS.rglob("*") if p.is_file() and p.suffix in (".json", ".html", ".txt", ".js")
            and fetch.KEY in p.read_text(encoding="utf-8", errors="ignore")]
    if leak:
        for p in leak:
            p.unlink()
        raise SystemExit(f"API key found in {len(leak)} output files; removed them")
    print("built", meta, fetch.stats)


if __name__ == "__main__":
    main()
