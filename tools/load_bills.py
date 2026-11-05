"""Fills the cache with full detail for every focus bill. Safe to stop and rerun: finished bills come from the cache.
Usage: py -3.12 load_bills.py"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import congress
import fetch


def main():
    bills = congress.bill_list()
    work = congress.focus(bills)
    print(len(bills), "bills;", len(work), "focus", flush=True)
    done = [0]
    start = time.time()

    def one(item):
        b, topics, parts = item
        try:
            congress.bill_detail(b["type"], b["number"], b.get("updateDateIncludingText") or b["updateDate"], parts)
        except Exception as e:  # one bad bill must not stop the run
            print("ERR", b["type"], b["number"], e, flush=True)
        done[0] += 1
        if done[0] % 50 == 0:
            print(done[0], "done", fetch.stats, f"{time.time() - start:.0f}s", flush=True)

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(one, work))
    print("FINISHED", fetch.stats, flush=True)


if __name__ == "__main__":
    sys.exit(main())
