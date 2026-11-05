"""HTTP access for the Bill Tracker loaders: one polite client with an on-disk cache.

The api.data.gov key (Congress.gov and GovInfo) is read from the CONGRESS_GOV_API_KEY environment variable, or from the
.env file named by BILLTRACKER_ENV. It is added to the request only and never written to the cache or the site:
cached files are keyed by the URL without the key, and scrub() removes it from anything a response echoes back.
"""
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
UA = "JAYANAS-BillTracker/1.0 (+https://jayanas.com; cnellore@jayanas.com)"
KEYED_HOSTS = ("api.congress.gov", "api.govinfo.gov")
DEFAULT_ENV = Path(r"C:\Users\chand\JAYANAS\Federal-SAM\Projects\rfq-bsee-140EE127Q0001\.env")


def _load_key():
    key = os.environ.get("CONGRESS_GOV_API_KEY", "").strip()
    if key:
        return key
    env = Path(os.environ.get("BILLTRACKER_ENV", DEFAULT_ENV))
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("CONGRESS_GOV_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("CONGRESS_GOV_API_KEY is not set")


KEY = _load_key()
_lock = threading.Lock()
_last = {"t": 0.0}
KEYED_INTERVAL = 0.75  # about 4,800 requests an hour, under the api.data.gov limit of 5,000
stats = {"net": 0, "cache": 0}


def scrub(text):
    return text.replace(KEY, "REDACTED")


def _path(url, ext):
    return CACHE / (hashlib.sha1(url.encode()).hexdigest() + ext)


def get(url, max_age=None, binary=False, retries=4):
    """Returns the body of url (str, or bytes when binary). Cached copies younger than max_age seconds are reused;
    max_age=None reuses any cached copy. Raises urllib.error.HTTPError for a final non-200."""
    path = _path(url, ".bin" if binary else ".txt")
    if path.exists() and (max_age is None or time.time() - path.stat().st_mtime < max_age):
        stats["cache"] += 1
        return path.read_bytes() if binary else path.read_text(encoding="utf-8")
    keyed = any(h in url for h in KEYED_HOSTS)
    full = url + (("&" if "?" in url else "?") + "api_key=" + KEY if keyed else "")
    for attempt in range(retries):
        if keyed:
            with _lock:
                wait = _last["t"] + KEYED_INTERVAL - time.time()
                if wait > 0:
                    time.sleep(wait)
                _last["t"] = time.time()
        req = urllib.request.Request(full, headers={"User-Agent": UA, "Accept": "application/json, text/xml, */*"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(20 * (attempt + 1) if e.code == 429 else 3 * (attempt + 1))
                continue
            raise urllib.error.HTTPError(url, e.code, e.reason, e.headers, None) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise
    stats["net"] += 1
    CACHE.mkdir(exist_ok=True)
    if binary:
        path.write_bytes(body)
        return body
    text = scrub(body.decode("utf-8", "replace"))
    path.write_text(text, encoding="utf-8")
    return text


def get_json(url, max_age=None):
    return json.loads(get(url, max_age))


def uncache(url):
    for ext in (".txt", ".bin"):
        p = _path(url, ext)
        if p.exists():
            p.unlink()


def cached(url, binary=False):
    return _path(url, ".bin" if binary else ".txt").exists()
