"""Congress.gov API loaders: bills, actions, amendments, committees, summaries, text versions, reports and members."""
import re
from concurrent.futures import ThreadPoolExecutor

from fetch import get, get_json

API = "https://api.congress.gov/v3"
CONGRESS = 119
DAY = 20 * 3600

APPROP = re.compile(r"appropriation|continuing|rescission|budget|debt limit|sequestration|supplemental", re.I)
ENERGY = re.compile(
    r"\benerg|\boil\b|natural gas|\bgas\b|offshore|outer continental shelf|\bOCS\b|mineral|mining|\bmine\b|leasing|"
    r"\blease|\bocean|seabed|marine|hydro|nuclear|uranium|pipeline|\bcoal\b|geothermal|\bwind\b|solar|\bLNG\b|"
    r"petroleum|electric|\bgrid\b|transmission|Interior|natural resources|public lands|federal lands|permitting|"
    r"helium|lithium|rare earth|Gulf of America|Gulf of Mexico|Alaska|royalt", re.I)
OFFSHORE = re.compile(r"\boffshore\b|outer continental shelf|\bOCS\b|marine minerals?|\bseabed|ocean energy|deep[- ]sea|"
                      r"critical minerals?|sand and gravel|\bBOEM\b|\bBSEE\b", re.I)
# Federal Register documents use a stricter test: "offshore" alone also matches Coast Guard safety zones
FR_OFFSHORE = re.compile(r"outer continental shelf|\bOCS\b|offshore (oil|gas|wind|energy|lease|leasing|drilling|platform|"
                         r"mineral|renewable|sand|area)|marine minerals?|\bseabed|deep[- ]sea (mining|mineral)|"
                         r"critical minerals?|sand and gravel|\bBOEM\b|\bBSEE\b", re.I)


def pages(path, key, limit=250, max_age=DAY, cap=None, extra=""):
    """Yields every item of a paginated Congress.gov list."""
    offset = 0
    while True:
        data = get_json(f"{API}/{path}?format=json&limit={limit}&offset={offset}{extra}", max_age)
        items = data.get(key, [])
        yield from items
        offset += limit
        if not items or "next" not in data.get("pagination", {}) or (cap and offset >= cap):
            return


def bill_list():
    return list(pages(f"bill/{CONGRESS}", "bills", extra="&sort=updateDate+desc"))


ADVANCED = re.compile(r"Passed|Became|Placed on|Reported|cloture|agreed to|Presented|Signed|vetoed|Received in the|"
                      r"Ordered to be reported|Pocket", re.I)
LEGIS = ("HR", "S", "HJRES", "SJRES")


def latest(b):
    return b.get("latestAction") or {}


def focus(bills):
    """(bill, topic set, parts) for every bill the tracker loads in full, appropriations first."""
    out = []
    for b in bills:
        if b["type"] not in LEGIS:
            continue
        topics = set()
        if APPROP.search(b["title"]):
            topics.add("budget")
        if ENERGY.search(b["title"]):
            topics.add("energy")
        if OFFSHORE.search(b["title"]):
            topics.add("offshore")
        if topics or ADVANCED.search(latest(b).get("text", "")):
            out.append((b, topics, FULL if "budget" in topics else BASIC))
    out.sort(key=lambda t: latest(t[0]).get("actionDate") or "", reverse=True)
    out.sort(key=lambda t: 0 if "budget" in t[1] else 1 if t[1] else 2)
    return out


def laws():
    return list(pages(f"law/{CONGRESS}", "bills"))


BASIC = ("actions", "amendments", "committees", "summaries", "text")
FULL = BASIC + ("relatedbills", "cosponsors")
KEYS = {"text": "textVersions", "relatedbills": "relatedBills"}


def bill_detail(btype, number, update, parts=BASIC):
    """Everything the bill page needs. update is the list's updateDateIncludingText, so a changed bill is refetched."""
    base = f"{API}/bill/{CONGRESS}/{btype.lower()}/{number}"
    v = f"&v={update}"
    out = {"bill": get_json(f"{base}?format=json{v}")["bill"]}
    counts = {"actions": "actions", "amendments": "amendments", "committees": "committees", "summaries": "summaries",
              "text": "textVersions", "relatedbills": "relatedBills", "cosponsors": "cosponsors"}
    for part in parts:
        key = KEYS.get(part, part)
        if not (out["bill"].get(counts[part]) or {}).get("count"):
            out[part] = []  # the bill record says this list is empty
            continue
        items, offset = [], 0
        while True:
            data = get_json(f"{base}/{part}?format=json&limit=250&offset={offset}{v}")
            items += data.get(key, [])
            offset += 250
            if "next" not in data.get("pagination", {}) or offset > 2000:
                break
        out[part] = items
    return out


def text_body(url):
    """Plain text of a GPO 'Formatted Text' version (an HTML page wrapping a <pre> block)."""
    html = get(url)
    m = re.search(r"<pre[^>]*>(.*)</pre>", html, re.S | re.I)
    body = m.group(1) if m else html
    body = re.sub(r"<[^>]+>", "", body)
    for a, b in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#x27;", "'"), ("&#39;", "'"), ("&amp;", "&")):
        body = body.replace(a, b)
    return body


def report(citation_url):
    data = get_json(citation_url.replace("?format=json", "") + "?format=json")
    reports = data.get("committeeReports", [])
    return reports[0] if reports else {}


def members(cached_only=False):
    """Current members and each one's detail record. cached_only skips details not yet cached (the list stands in)."""
    from fetch import cached
    current = list(pages("member", "members", extra="&currentMember=true"))

    def detail(m):
        url = f"{API}/member/{m['bioguideId']}?format=json"
        if cached_only and not cached(url):
            return {"terms": (m.get("terms") or {}).get("item", []), "state": m.get("state"), "depiction": m.get("depiction")}
        return get_json(url, 6 * DAY)["member"]

    with ThreadPoolExecutor(4) as pool:
        details = list(pool.map(detail, current))
    return current, details


def sponsored(bioguide):
    return get_json(f"{API}/member/{bioguide}/sponsored-legislation?format=json&limit=20", 2 * DAY).get(
        "sponsoredLegislation", [])


def committees():
    return list(pages(f"committee/{CONGRESS}", "committees", max_age=6 * DAY))


def house_vote_list():
    out = []
    for session in (1, 2):
        out += list(pages(f"house-vote/{CONGRESS}/{session}", "houseRollCallVotes"))
    return out
