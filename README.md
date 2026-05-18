# Insomnia

> *The things that keep you up at night.*

A coverage dashboard that ties **Threat Research Reports (TRRs)** to **Procedure Coverage Records (PCRs)** to show, at a glance, where detection coverage exists, where gaps are documented, and where opportunities remain.

Insomnia is a static site — pure HTML / CSS / JS, no backend — built to be hosted on GitHub Pages. It reads index files directly from one or more TRR and PCR source repositories at page load and joins them on procedure ID.

---

## Quick start

1. Fork or clone this repository.
2. Edit `sources.json` to point at your TRR and PCR source repositories (see [Configuration](#configuration) below).
3. Enable GitHub Pages on the repository (Settings → Pages → "Deploy from a branch" → `main` / root).
4. Visit the resulting URL.

The repository ships with example data bundled under `data/` so the dashboard is immediately runnable for evaluation before you point it at real sources.

---

## How it works

### Data model

Insomnia loads each source's `index.json` and joins them on **procedure ID** (e.g. `TRR0030.WIN.A`).

- A **TRR** defines one or more procedures (each gets an ID composed from the TRR ID, a platform short code, and a letter).
- A **PCR** is one of three kinds:
  - `Gap Record` — a documented gap (counts as **not covered**)
  - `Coverage Record` — coverage that is not a custom detection (preventive policy, third-party tool, etc.)
  - `Detection - *` — a custom detection. Any `Detection - <subtype>` value is treated as a detection.

Each PCR lists the procedure IDs it addresses. A procedure with no PCR referencing it is treated as an **opportunity** — distinct from a documented gap, because nobody has touched it yet.

### Per-procedure state

For each procedure, Insomnia counts the **active** (not retired) PCRs that reference it:

| Condition                          | State         |
|------------------------------------|---------------|
| No PCRs reference it               | `opportunity` |
| Only covered records, no gaps      | `covered`     |
| Only gap records, no coverage      | `gap`         |
| Both covered and gap records       | `partial`     |

The **coverage fraction** for a procedure is `covered_records / (covered_records + gap_records)`, or `0` if there are no records.

### Metrics

**Coverage score** *(open-ended)* — `2 × #TRRs + Σ procedure_fractions`. Has no theoretical maximum; the value is interpreted relative to its own history (see the sparkline). The score rewards both research breadth (TRRs) and detection depth (procedure coverage), with coverage proportionally split when records conflict.

**Attack surface covered (%)** — `Σ procedure_fractions / #procedures × 100`. A procedure with one coverage record and one gap record contributes `0.5` to the numerator, matching the score's proportional treatment.

**Historical trend** — Both metrics are also computed retrospectively from `pub_date` values: at each date present in either index, the dashboard reconstructs what the score and surface % would have been if that date were "today." This gives an honest trend line without requiring snapshot data. PCRs without a `pub_date` are treated as always-existing.

---

## Configuration

Edit `sources.json`. It is an array of source entries. Each entry needs a `Name`, a `Type`, and either a `Repo` (for GitHub-hosted data) or a `LocalPath` (for data bundled inside the Insomnia repo itself).

### GitHub-hosted source

```json
{
  "Name": "Tired Labs",
  "Type": "TRR",
  "Repo": "https://github.com/tired-labs/techniques"
}
```

Insomnia derives everything it needs from the repo URL:

- Where to fetch `index.json` and `platforms.json` → `raw.githubusercontent.com/<owner>/<repo>/<branch>/`
- Where each record's README lives for deep links → `github.com/<owner>/<repo>/blob/<branch>/...`

The branch defaults to `main`. To use a different branch, either set `"Branch": "develop"` or paste a `tree/<branch>` URL like `https://github.com/owner/repo/tree/develop`.

### Locally-bundled source

```json
{
  "Name": "Example",
  "Type": "TRR",
  "LocalPath": "data/example-trr/"
}
```

`LocalPath` is a folder under the deployed Insomnia site that contains `index.json` (and, for TRR sources, optionally `platforms.json`). Local sources don't produce deep links to record READMEs — card titles render as plain text instead of links.

### Field reference

| Field       | Required           | Notes                                                                                              |
|-------------|--------------------|----------------------------------------------------------------------------------------------------|
| `Name`      | yes                | Display name. Shown on cards as a source pill.                                                     |
| `Type`      | yes                | `"TRR"` or `"PCR"`.                                                                                |
| `Repo`      | one of Repo/LocalPath | GitHub repo URL. e.g. `https://github.com/owner/repo` or `https://github.com/owner/repo/tree/dev`. |
| `Branch`    | no                 | Override the branch. Defaults to `main` (or whatever is parsed out of `Repo`).                     |
| `LocalPath` | one of Repo/LocalPath | Folder under the site root containing `index.json`.                                                |

A source must set **exactly one** of `Repo` or `LocalPath`. Misconfigured sources are dropped on load with a banner in the dashboard explaining the error.

### Link construction

For sources backed by a `Repo`, Insomnia builds direct README links using these patterns:

- **TRR** → `<repo>/blob/<branch>/<trr_id_lowercase>/<platform_short_lowercase>/README.md`
  e.g. `TRR0030` on Windows → `…/blob/main/trr0030/win/README.md`. The platform segment is the lowercased short code from `platforms.json` (e.g. `win`, `ad`, `azr`), matching the convention used in procedure IDs (`TRR0030.WIN.A`).
- **PCR** → `<repo>/blob/<branch>/<pcr_id_lowercase>/README.md`
  e.g. `PCR0010` → `…/blob/main/pcr0010/README.md`.

`LocalPath` sources don't generate deep links.

You can configure any number of TRR sources and any number of PCR sources. Insomnia merges them all into a single model and joins on procedure ID across sources.

### Example: two TRR sources, one PCR source

```json
[
  {
    "Name": "Tired Labs",
    "Type": "TRR",
    "Repo": "https://github.com/tired-labs/techniques"
  },
  {
    "Name": "Internal Research",
    "Type": "TRR",
    "Repo": "https://github.com/example/internal-trrs",
    "Branch": "develop"
  },
  {
    "Name": "Detection Engineering",
    "Type": "PCR",
    "Repo": "https://github.com/example/pcrs"
  }
]
```

### CORS

Insomnia fetches `index.json` files from the browser, so the host serving them must permit CORS (`Access-Control-Allow-Origin`). `raw.githubusercontent.com` does this by default. For internal repositories on GitHub Enterprise, you may need to mirror the index into the Insomnia repo (via a scheduled GitHub Action, for example) and reference it with `LocalPath` instead.

---

## Library-only mode (TRR Library front-end)

Insomnia automatically detects when no PCR source is configured and adapts:

- The Dashboard view is hidden (the landing page becomes Techniques instead).
- Coverage indicators are removed from Technique cards (no percentages, no swatches, no record counts).
- The Matrix view stays available — it renders the same kill-chain layout as ATT&CK Navigator, with cells uncolored since there's no coverage signal.

This means you can drop Insomnia into a TRR repository as a stand-alone library front-end by leaving `sources.json` with only TRR entries. To enable full coverage-tracking mode, add at least one `Type: "PCR"` entry pointing at a PCR repository.

## Views

**Dashboard** (`index.html`) — Headline coverage metrics, breakdown by tactic and platform, top gaps & opportunities, orphaned PCR detection. Hidden in library-only mode.

**Techniques** (`techniques.html`) — Card-per-TRR browse with filters (platform, tactic, recency, coverage state) and sort. Each card's title links directly to the source TRR if `BaseUrl` is configured.

**Matrix** (`matrix.html`) — ATT&CK Navigator-style threat matrix: tactics across the top in kill-chain order, TRRs stacked under each tactic column they apply to. Cells colored by coverage state (when PCR data is loaded) and sorted with what-needs-work at the top of each column.



```
.
├── index.html               # Dashboard (front door)
├── techniques.html          # TRR browse view with coverage indicators
├── matrix.html              # ATT&CK-style threat coverage matrix
├── sources.json             # Source repository configuration
├── data/                    # Bundled example data (delete when configuring real sources)
├── css/insomnia.css         # All styling
├── js/
│   ├── app.js               # Shared init (theme toggle, header)
│   ├── data.js              # Fetch, normalize, join indices
│   ├── metrics.js           # Score, surface %, trend
│   ├── dashboard.js         # Dashboard renderer
│   ├── techniques.js        # Techniques browse renderer
│   └── matrix.js            # Threat matrix renderer
└── img/                     # Logo / eye assets
```

---

## Development notes

- **No build step.** Pure ES modules served as-is. Open `index.html` over a local web server (not `file://`, because ES modules require an HTTP origin). `python3 -m http.server` from the repo root works fine.
- **No external runtime dependencies** beyond the Tabler icons webfont, which is loaded from a CDN. Everything else is hand-rolled to keep the SOC-after-midnight aesthetic intentional.
- **Procedure ID platform codes** are derived heuristically from a TRR's first listed platform (see `platformShortCode` in `js/data.js`). For sources that use non-standard platforms, extend that function. A future version will read this mapping from each TRR source's `platforms.json`.
