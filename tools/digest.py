"""Daily digest: one email-ready HTML page (inline styles, semantic headings, real link text) and a plain-text version
for each business morning, covering what happened since the previous business day.

The tracker writes the digests to docs/digest/. Delivery to subscribers is done by send_digest.py, which only sends
when an SMTP server is configured and --send is given.
"""
import datetime as dt
import html
import json
import os
import re

SITE = os.environ.get("BILLTRACKER_SITE", "https://chandranellore.github.io/bill-tracker/")
DAYS = 10
NAVY, INK, MUTED, RULE = "#1f3a5f", "#1b1b1b", "#4a4a4a", "#d0d7de"


def esc(s):
    return html.escape(str(s or ""), quote=True)


def label(row):
    t = row[1]
    names = {"HR": "H.R.", "S": "S.", "HJRES": "H.J.Res.", "SJRES": "S.J.Res.", "HRES": "H.Res.", "SRES": "S.Res.",
             "HCONRES": "H.Con.Res.", "SCONRES": "S.Con.Res."}
    return f"{names.get(t, t)} {row[2]}"


def business_days(end, n):
    days, d = [], end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= dt.timedelta(days=1)
    return days


def window(day):
    """A digest on `day` covers from the previous business day through the day before `day`."""
    prev = day - dt.timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= dt.timedelta(days=1)
    start = prev
    end = day - dt.timedelta(days=1)
    return start.isoformat(), end.isoformat()


def collect(day, records, rows, feed, fr, cbo):
    start, end = window(day)
    inside = lambda d: start <= (d or "") <= end
    sec = {"budget": [], "floor": [], "energy": [], "law": [], "new": [], "fr": [], "cbo": [], "votes": []}
    seen = set()
    for e in feed:
        if not inside(e["d"]):
            continue
        if e["k"] == "action":
            row = rows.get(e["id"])
            if not row:
                continue
            key = (e["id"], e["t"])
            if key in seen:
                continue
            seen.add(key)
            item = {"id": e["id"], "label": label(row), "title": row[3], "text": e["t"], "date": e["d"]}
            topics = row[8]
            if re.search(r"Became Public Law|Signed by President|Presented to President|Vetoed", e["t"]):
                sec["law"].append(item)
            elif re.search(r"Passed|agreed to|Agreed to|Failed|cloture|Cloture", e["t"]) and row[1] in ("HR", "S", "HJRES", "SJRES"):
                sec["floor"].append(item)
            if "b" in topics:
                sec["budget"].append(item)
            elif "e" in topics or "o" in topics:
                sec["energy"].append(item)
            elif re.search(r"^Introduced|Referred to|Read twice and referred", e["t"]) and topics:
                sec["new"].append(item)
        elif e["k"] == "vote":
            sec["votes"].append({"text": e["t"], "chamber": e["ch"], "key": e["key"], "date": e["d"]})
    for d in fr:
        if inside(d["date"]) and d["type"] in ("Rule", "Proposed Rule", "Presidential Document", "Notice"):
            sec["fr"].append(d)
    for c in cbo:
        if inside(c["date"]):
            sec["cbo"].append(c)
    rank = {"Rule": 0, "Proposed Rule": 1, "Presidential Document": 2, "Notice": 3}
    sec["fr"].sort(key=lambda d: (0 if "offshore" in d["topics"] else 1, rank.get(d["type"], 4)))
    return start, end, sec


def bill_link(item):
    return f'{SITE}#/bill/{item["id"]}'


def render(day, start, end, sec):
    when = day.strftime("%A, %B %-d, %Y") if os.name != "nt" else day.strftime("%A, %B %#d, %Y")
    span = start if start == end else f"{start} to {end}"
    H = []
    a = lambda href, text: f'<a href="{esc(href)}" style="color:{NAVY};">{esc(text)}</a>'
    h2 = lambda text: (f'<h2 style="font-size:17px;color:{NAVY};margin:24px 0 8px;padding-bottom:4px;'
                       f'border-bottom:2px solid {RULE};">{esc(text)}</h2>')
    none = f'<p style="color:{MUTED};margin:4px 0;">No new action.</p>'

    def bills(items, cap=25):
        if not items:
            return none
        out = ['<ul style="padding-left:20px;margin:4px 0;">']
        for it in items[:cap]:
            out.append(f'<li style="margin:0 0 8px;"><strong>{a(bill_link(it), it["label"])}</strong> {esc(it["title"][:160])}'
                       f'<br><span style="color:{MUTED};">{esc(it["date"])}: {esc(it["text"][:300])}</span></li>')
        if len(items) > cap:
            out.append(f'<li>{a(SITE + "#/activity", f"{len(items) - cap} more in the tracker")}</li>')
        out.append("</ul>")
        return "".join(out)

    H.append(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
             f'<title>JAYANAS Bill Tracker daily digest, {esc(when)}</title></head>'
             f'<body style="margin:0;padding:0;background:#ffffff;">'
             f'<main style="max-width:680px;margin:0 auto;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;'
             f'line-height:1.5;color:{INK};">')
    H.append(f'<p style="margin:0;font-size:13px;color:{MUTED};">JAYANAS Bill Tracker</p>'
             f'<h1 style="font-size:22px;color:{NAVY};margin:2px 0 4px;">Budget and legislative digest</h1>'
             f'<p style="margin:0 0 8px;color:{MUTED};">{esc(when)}. Covers official actions dated {esc(span)}.</p>')
    counts = [("Budget and appropriations", len(sec["budget"])), ("Floor votes", len(sec["votes"])),
              ("Energy and minerals", len(sec["energy"])), ("Federal Register", len(sec["fr"]))]
    H.append('<p style="margin:0 0 8px;">' + " | ".join(f"{esc(k)}: {v}" for k, v in counts) + "</p>")

    H.append(h2("Budget and appropriations"))
    H.append(bills(sec["budget"]))
    if sec["cbo"]:
        H.append(f'<h3 style="font-size:15px;margin:12px 0 4px;">Congressional Budget Office</h3><ul style="padding-left:20px;margin:4px 0;">')
        for c in sec["cbo"][:15]:
            H.append(f'<li style="margin:0 0 6px;">{a(c["url"], c["title"])}</li>')
        H.append("</ul>")

    H.append(h2("Passed, failed or sent to the President"))
    H.append(bills(sec["law"] + sec["floor"]))

    H.append(h2("Roll-call votes"))
    if sec["votes"]:
        H.append('<ul style="padding-left:20px;margin:4px 0;">')
        for v in sec["votes"][:30]:
            H.append(f'<li style="margin:0 0 6px;">{esc(v["chamber"])}: {a(SITE + "#/vote/" + v["chamber"].lower() + "/" + v["key"], v["text"][:220])}</li>')
        H.append("</ul>")
    else:
        H.append(none)

    H.append(h2("Energy and minerals legislation"))
    H.append(bills(sec["energy"]))

    H.append(h2("Federal Register: energy, offshore and budget agencies"))
    if sec["fr"]:
        H.append('<ul style="padding-left:20px;margin:4px 0;">')
        for d in sec["fr"][:25]:
            flag = "<strong>Offshore or minerals.</strong> " if "offshore" in d["topics"] else ""
            extra = f' Comments close {esc(d["comments"])}.' if d.get("comments") else ""
            H.append(f'<li style="margin:0 0 8px;">{flag}{a(d["url"], d["title"][:200])}<br><span style="color:{MUTED};">'
                     f'{esc(d["type"])}, {esc("; ".join(d["agencies"][:2]))}.{extra}</span></li>')
        if len(sec["fr"]) > 25:
            H.append(f'<li>{a(SITE + "#/energy", str(len(sec["fr"]) - 25) + " more in the energy view")}</li>')
        H.append("</ul>")
    else:
        H.append(none)

    if sec["new"]:
        H.append(h2("New bills on these topics"))
        H.append(bills(sec["new"]))

    H.append(f'<hr style="border:0;border-top:1px solid {RULE};margin:24px 0 8px;">'
             f'<p style="font-size:13px;color:{MUTED};">Drawn from Congress.gov, the House Clerk, Voteview, the Federal Register, '
             f'GovInfo and CBO. Summaries of bills are by the Congressional Research Service. JAYANAS Bill Tracker does not '
             f'publish original news reporting. {a(SITE + "#/alerts", "Change your alerts")}.</p>')
    H.append("</main></body></html>")
    return "".join(H)


def as_text(start, end, sec, when):
    lines = [f"JAYANAS Bill Tracker daily digest, {when}", f"Official actions dated {start} to {end}", ""]

    def block(title, items):
        lines.append(title.upper())
        if not items:
            lines.append("  No new action.")
        for it in items[:25]:
            lines.append(f"- {it['label']} {it['title'][:120]}")
            lines.append(f"  {it['date']}: {it['text'][:240]}")
            lines.append(f"  {bill_link(it)}")
        lines.append("")

    block("Budget and appropriations", sec["budget"])
    block("Passed, failed or sent to the President", sec["law"] + sec["floor"])
    lines.append("ROLL-CALL VOTES")
    lines += [f"- {v['chamber']}: {v['text'][:200]}" for v in sec["votes"][:30]] or ["  No new action."]
    lines.append("")
    block("Energy and minerals legislation", sec["energy"])
    lines.append("FEDERAL REGISTER")
    lines += [f"- {d['type']}: {d['title'][:180]}\n  {d['url']}" for d in sec["fr"][:25]] or ["  No new action."]
    return "\n".join(lines) + "\n"


def build_digests(records, rows, feed, fr, cbo, hvotes, svotes, docs):
    out_dir = docs / "digest"
    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for day in business_days(dt.date.today(), DAYS):
        start, end, sec = collect(day, records, rows, feed, fr, cbo)
        name = day.isoformat()
        when = day.strftime("%A, %B %d, %Y")
        (out_dir / f"{name}.html").write_text(render(day, start, end, sec), encoding="utf-8")
        (out_dir / f"{name}.txt").write_text(as_text(start, end, sec, when), encoding="utf-8")
        index.append({"date": name, "start": start, "end": end,
                      "counts": {k: len(v) for k, v in sec.items()}})
    for old in out_dir.glob("*.html"):
        if old.stem not in {i["date"] for i in index}:
            old.unlink()
            old.with_suffix(".txt").unlink(missing_ok=True)
    return index
