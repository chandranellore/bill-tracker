"""Delivers a daily digest to subscribers by email.

By default it only writes one .eml file per subscriber to outbox/ so the message can be checked. It sends only with
--send and an SMTP server configured in the environment (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, DIGEST_FROM).
Subscribers are read from subscribers.json: [{"email": "...", "name": "...", "digest": true}].

Usage: py -3.12 send_digest.py [YYYY-MM-DD] [--send]
"""
import datetime as dt
import json
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def message(day, to, sender):
    html = (ROOT / "docs" / "digest" / f"{day}.html").read_text(encoding="utf-8")
    text = (ROOT / "docs" / "digest" / f"{day}.txt").read_text(encoding="utf-8")
    msg = EmailMessage()
    msg["Subject"] = f"Budget and legislative digest, {dt.date.fromisoformat(day):%B %d, %Y}"
    msg["From"] = sender
    msg["To"] = to
    msg["List-Unsubscribe"] = f"<mailto:{sender}?subject=unsubscribe>"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    day = args[0] if args else dt.date.today().isoformat()
    send = "--send" in sys.argv
    subs_path = ROOT / "subscribers.json"
    subs = [s for s in json.loads(subs_path.read_text(encoding="utf-8")) if s.get("digest", True)] if subs_path.exists() else []
    sender = os.environ.get("DIGEST_FROM", "JAYANAS Bill Tracker <digest@jayanas.com>")
    if not subs:
        subs = [{"email": "subscriber@example.gov"}]
        send = False
    outbox = ROOT / "outbox"
    outbox.mkdir(exist_ok=True)
    msgs = [message(day, s["email"], sender) for s in subs]
    if not send:
        for s, m in zip(subs, msgs):
            path = outbox / f"{day}_{s['email'].replace('@', '_at_')}.eml"
            path.write_bytes(bytes(m))
            print("wrote", path)
        return
    host = os.environ["SMTP_HOST"]
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587"))) as smtp:
        smtp.starttls()
        if os.environ.get("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        for m in msgs:
            smtp.send_message(m)
            print("sent", m["To"])


if __name__ == "__main__":
    main()
