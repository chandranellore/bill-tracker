"""Roll-call votes.

House: the Clerk's roll-call XML (clerk.house.gov/evs/YYYY/rollNNN.xml), member by member.
Senate: senate.gov refuses scripted access, so the tracker does not fetch it. Senate tallies come from Congress.gov bill
actions (recordedVotes), and member-by-member Senate positions from Voteview (UCLA), whose bulk files are compiled from
the official Senate record and offered for download. Voteview updates periodically, not the same day.
"""
import csv
import io
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from fetch import get

DAY = 20 * 3600
CODES = {"Yea": "Y", "Aye": "Y", "Nay": "N", "No": "N", "Present": "P", "Not Voting": "X"}
VOTEVIEW = "https://voteview.com/static/data/out"


def _text(el, path):
    found = el.find(path)
    return (found.text or "").strip() if found is not None else ""


def house_roll(year, roll, max_age=None):
    xml = get(f"https://clerk.house.gov/evs/{year}/roll{roll:03d}.xml", max_age, binary=True)
    root = ET.fromstring(xml)
    meta = root.find("vote-metadata")
    totals = meta.find("vote-totals/totals-by-vote")
    vote = {
        "chamber": "House", "year": year, "roll": roll,
        "congress": int(_text(meta, "congress") or 0), "session": _text(meta, "session"),
        "date": _text(meta, "action-date"), "time": _text(meta, "action-time"),
        "legis": _text(meta, "legis-num"), "question": _text(meta, "vote-question"),
        "type": _text(meta, "vote-type"), "result": _text(meta, "vote-result"), "desc": _text(meta, "vote-desc"),
        "yea": int(_text(totals, "yea-total") or 0) if totals is not None else 0,
        "nay": int(_text(totals, "nay-total") or 0) if totals is not None else 0,
        "present": int(_text(totals, "present-total") or 0) if totals is not None else 0,
        "nv": int(_text(totals, "not-voting-total") or 0) if totals is not None else 0,
        "party": [{"party": _text(p, "party"), "yea": _text(p, "yea-total"), "nay": _text(p, "nay-total"),
                   "present": _text(p, "present-total"), "nv": _text(p, "not-voting-total")}
                  for p in meta.findall("vote-totals/totals-by-party")],
        "positions": {},
    }
    for rv in root.findall("vote-data/recorded-vote"):
        leg = rv.find("legislator")
        bio = leg.get("name-id")
        if bio:
            vote["positions"][bio] = CODES.get(_text(rv, "vote"), _text(rv, "vote")[:1])
    return vote


def house_votes(vote_list):
    """vote_list is Congress.gov's house-vote list; each item names its Clerk XML file."""
    jobs = []
    for v in vote_list:
        m = re.search(r"/evs/(\d{4})/roll(\d+)\.xml", v.get("sourceDataURL", ""))
        if m:
            jobs.append((int(m.group(1)), int(m.group(2)), v.get("updateDate", "")))
    newest = max((y, r) for y, r, _ in jobs) if jobs else None

    def one(job):
        year, roll, _ = job
        try:
            return house_roll(year, roll, DAY if (year, roll) == newest else None)
        except Exception as e:
            print("house vote", year, roll, e)
            return None

    with ThreadPoolExecutor(4) as pool:
        return [v for v in pool.map(one, jobs) if v]


def senate_voteview(congress=119):
    rolls = list(csv.DictReader(io.StringIO(get(f"{VOTEVIEW}/rollcalls/S{congress}_rollcalls.csv", DAY))))
    members = list(csv.DictReader(io.StringIO(get(f"{VOTEVIEW}/members/S{congress}_members.csv", DAY))))
    casts = csv.DictReader(io.StringIO(get(f"{VOTEVIEW}/votes/S{congress}_votes.csv", DAY)))
    icpsr = {m["icpsr"]: m.get("bioguide_id", "") for m in members}
    # Voteview cast codes: 1-3 yea, 4-6 nay, 7-8 present, 9 not voting, 0 not a member
    code = {"1": "Y", "2": "Y", "3": "Y", "4": "N", "5": "N", "6": "N", "7": "P", "8": "P", "9": "X"}
    votes = {}
    for r in rolls:
        votes[int(r["rollnumber"])] = {
            "chamber": "Senate", "roll": int(r["rollnumber"]), "congress": congress, "date": r["date"],
            "session": r.get("session", ""), "legis": r.get("bill_number", ""), "question": r.get("vote_question", ""),
            "result": r.get("vote_result", ""), "desc": r.get("vote_desc", "") or r.get("dtl_desc", ""),
            "yea": int(float(r.get("yea_count") or 0)), "nay": int(float(r.get("nay_count") or 0)),
            "clerk_roll": r.get("clerk_rollnumber", ""), "positions": {}}
    for c in casts:
        v = votes.get(int(c["rollnumber"]))
        bio = icpsr.get(c["icpsr"])
        if v is not None and bio and c["cast_code"] in code:
            v["positions"][bio] = code[c["cast_code"]]
    return [votes[k] for k in sorted(votes)]
