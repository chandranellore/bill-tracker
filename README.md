# JAYANAS Bill Tracker

Federal budget, appropriations, legislative and energy-policy tracking from official sources. It's a static site
(`docs/`, served by GitHub Pages at https://chandranellore.github.io/bill-tracker/) over JSON files that
`tools/build.py` rebuilds each day.

## Features

| Feature | Where |
|---|---|
| Search: bill numbers, titles and latest actions for every 119th Congress bill, plus votes, members and Federal Register documents, with filters | `#/search` |
| Bill page: stage tracker, actions, amendments, committees, CRS summaries, CBO estimates, text versions, version comparison | `#/bill/hr9171` |
| Watch list, kept in the browser for the demo | `#/watch` |
| Alerts on keyword, bill, committee or member, delivered immediately, daily or weekly, with an email preview | `#/alerts` |
| Daily digest email, HTML and plain text, last 10 business days | `#/digest`, `docs/digest/` |
| Budget: FY 2027 and FY 2026 appropriations status, CRs, CBO, President's budget | `#/budget` |
| Energy and minerals: bills, Federal Register, committee activity, own keywords | `#/energy` |
| Roll-call votes, member by member | `#/votes`, `#/vote/house/2026-74` |
| Member profiles | `#/members`, `#/member/A000055` |

## Data sources

| Data | Source | Loader |
|---|---|---|
| Bills, actions, amendments, committees, summaries, text versions, cosponsors, related bills, members, House vote list | Congress.gov API (api.data.gov key) | `tools/congress.py` |
| Bill text for comparison | GPO formatted text linked from Congress.gov | `congress.text_body` |
| House roll calls, member by member | clerk.house.gov roll-call XML | `tools/votes.py` |
| Senate roll-call tallies | Congress.gov bill actions (`recordedVotes`) | `build.vote_data` |
| Senate positions, member by member | Voteview (UCLA) bulk CSV. senate.gov refuses scripted access, and the tracker does not fetch it | `votes.senate_voteview` |
| Committee assignments, contact details | unitedstates/congress-legislators (public domain) | `sources.committee_rosters` |
| Rules, proposed rules and notices | Federal Register API | `sources.federal_register` |
| CBO publications | CBO RSS, kept as a running history in `cache/` | `sources.cbo` |
| President's budget | GovInfo BUDGET collection | `sources.budget_documents` |

Bioguide (bioguide.congress.gov) is behind bot protection. Profiles link to it and do not fetch it.

## Build

```
py -3.12 tools\load_bills.py      # full detail for about 2,500 focus bills into cache\ (about 2 hours from empty; minutes after)
py -3.12 tools\build.py           # writes docs\data, docs\digest
py -3.12 tools\send_digest.py     # writes .eml previews to outbox\; sends only with --send and SMTP_* set
```

`tools\refresh.ps1` runs the load and the build, then commits and pushes `docs/`.

The key is read from `CONGRESS_GOV_API_KEY`, or from the `.env` that `tools/fetch.py` names. It is never written to
`cache/` or `docs/`, and `build.py` stops if it finds the key in any output file.

## Preview

`.claude/launch.json` serves `docs/` on http://localhost:8790.

## Accessibility

Built to Section 508 / WCAG 2.1 AA: skip link, landmarks, one h1 per view with focus moved to it on navigation, labelled
controls, table captions and header cells, visible focus, a live region for result counts, insertions and deletions
marked in text as well as color, and reflow at 320 px. Checked with axe-core.
