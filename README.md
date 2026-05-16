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

Edit `sources.json`. It is an array of source entries, each of which is one of:

```json
{
  "Name": "Tired Labs",
  "Type": "TRR",
  "BaseUrl": "https://library.tired-labs.org/",
  "RawIndexBaseUrl": "https://raw.githubusercontent.com/tired-labs/techniques/main/"
}
```

| Field             | Required | Notes                                                                                         |
|-------------------|----------|-----------------------------------------------------------------------------------------------|
| `Name`            | yes      | Display name. Shown on TRR cards as a source pill.                                            |
| `Type`            | yes      | `"TRR"` or `"PCR"`.                                                                           |
| `BaseUrl`         | no       | Human-facing URL of the source. If set, TRR IDs in the browse view link out to it.            |
| `RawIndexBaseUrl` | yes      | Where to fetch `index.json` from. Can be an absolute URL or a path relative to the site root. |

You can configure any number of TRR sources and any number of PCR sources. Insomnia merges them all into a single model and joins on procedure ID across sources.

### Example: two TRR sources, one PCR source

```json
[
  {
    "Name": "Tired Labs",
    "Type": "TRR",
    "BaseUrl": "https://library.tired-labs.org/",
    "RawIndexBaseUrl": "https://raw.githubusercontent.com/tired-labs/techniques/main/"
  },
  {
    "Name": "Internal Research",
    "Type": "TRR",
    "BaseUrl": "https://internal.example.com/trrs/",
    "RawIndexBaseUrl": "https://raw.githubusercontent.com/example/internal-trrs/main/"
  },
  {
    "Name": "Detection Engineering",
    "Type": "PCR",
    "BaseUrl": "https://internal.example.com/pcrs/",
    "RawIndexBaseUrl": "https://raw.githubusercontent.com/example/pcrs/main/"
  }
]
```

### CORS

Insomnia fetches `index.json` files from the browser, so the host serving them must permit CORS (`Access-Control-Allow-Origin`). `raw.githubusercontent.com` does this by default. For internal repositories on GitHub Enterprise or a private host, you may need to either:

- Proxy the index through a CORS-friendly endpoint, or
- Mirror the index into the Insomnia repo via a scheduled GitHub Action and point `RawIndexBaseUrl` at the local mirror.

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

---

## Roadmap

- **Future:** Read platform short-code mapping from each source's `platforms.json` rather than the heuristic function.
- **Future:** Trend "decay" view — flag procedures whose most recent record is more than N days old.
- **Future:** PCR detail drilldowns (clicking a procedure row opens a panel with the referencing PCRs and their AVL rule IDs).
- **Future:** GitHub Action to commit a daily snapshot of computed metrics, enabling longer-horizon trend data than what's derivable from `pub_date` alone.
