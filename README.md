# Insomnia

> *The things that keep you up at night.*

A dashboard that ties **Technique Research Reports (TRRs)** to **coverage
records** to show, at a glance, where detection coverage exists, where gaps are
documented, and where opportunities remain.

Insomnia is a static site — HTML, CSS, and JavaScript, no backend and no build
step. It reads the `index.json` published by each configured source repository
and joins them on procedure ID.

With only a library source it also serves as a front end for a TRR library on
its own; that is the configuration behind the public TIRED Labs library.

## Getting started

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for setup: choosing where to
host it, configuring sources, and pulling in private data. **Read the hosting
section first** — a deployment loading your own coverage or gap records maps
what your organization can and cannot detect, and must not be published.

The short version:

```bash
cp local/config.example.json local/config.json   # then edit it
python3 -m http.server 8000                      # open http://localhost:8000
```

`file://` will not work; the browser blocks `fetch` from local files.

For how the pieces fit together, see **[docs/DESIGN.md](docs/DESIGN.md)**.

## How it works

### Sources

`local/config.json` lists the repositories to read. Each has a `Type`:

| Type | Supplies |
|------|----------|
| `library` | Technique research: reports and their procedures |
| `coverage` | Coverage and gap records, joined onto those procedures |
| `validation`, `emulation` | Reserved; pulled but not yet displayed |

and a `Load` mode: `live` fetches the index from the repository directly,
`local` reads it from `data/`. Private repositories must be `local`, since a
browser cannot fetch them. Full details are in the deployment guide.

### The join

Every index is a schema-2 envelope carrying its records and a map of platform
display names to short codes. A procedure ID combines the report ID, that
short code, and a letter — `TRR0030.WIN.A` — and each coverage record lists
the procedure IDs it addresses.

A record naming a platform its own index does not define is skipped and
reported as a load error. Nothing is guessed: a wrong short code produces a
procedure ID that silently fails to match, which would read as missing
coverage rather than as a data problem.

Coverage sources hold three record types. **Coverage**: something detects or
prevents the procedure, named by its `provider`. **Gap**: the procedure was
assessed and cannot be covered. **Opportunity**: a published way the procedure
could be detected, described without implementation detail. Opportunities are
never coverage; the public library of them tells an organization where a
detection path already exists.

### Per-procedure state

A procedure's state comes from the organization's own active (not retired)
coverage and gap records. Published opportunities matter only where it has
neither:

| Condition | State |
|-----------|-------|
| Only coverage, no gaps | `covered` |
| Only gaps, no coverage | `gap` |
| Both | `partial` |
| Neither, but a published opportunity exists | `opportunity` |
| No records of any kind | `unassessed` |

A gap is a known, documented absence. An opportunity is a procedure with a
ready starting point that nobody has acted on. An unassessed procedure is one
nobody has looked at, and nobody has published a way to detect.

Once a procedure has a coverage or gap record, its state follows those alone,
even if more opportunities are published for it. Opportunities are
alternatives, not a checklist — one reliable detection is full coverage — so
which and how many to build is the engineer's call. Each procedure's row still
shows how many opportunities exist for it, as a menu to choose from.

The coverage fraction for a procedure is `coverage / (coverage + gaps)`, or `0`
with no records. Opportunities never change it.

### Metrics

**Attack surface awareness** *(open-ended)* — `2 × #TRRs + 1 × #active
coverage and gap records`. It rewards both research breadth and the work of
assessing it, and is read against its own history rather than against a
maximum. Opportunity records don't count: the TRR already represents awareness
of the procedure, and an opportunity only marks where more coverage could come
from.

**Attack surface covered (%)** — the sum of procedure fractions over the number
of procedures. A procedure with one coverage record and one gap contributes
`0.5`. Opportunities never change it either.

**Trend** — both metrics are reconstructed from each record's `pub_date`, so
the sparklines show real history without storing snapshots. This is why a
repository's original publication dates matter: an index rebuilt from scratch
stamps every record with today's date and flattens the trend.

The trend is a sense of direction, not an audit trail, so it is sampled at 60
evenly spaced dates rather than at every publication — which also keeps the
sparkline's horizontal axis proportional to time. It is built in a single pass
over the publications, sorted by date, so its cost grows with the size of the
data rather than with its square. The "+N in the last 90 days" figures stay
exact: the start of that window is always one of the sampled dates.

### Load problems

Errors and warnings appear at the top of every page. Insomnia checks what no
single source can: conflicting platform codes between two sources, records
naming undefined platforms, index versions it does not understand, and
records pointing at procedures no library provides.

## Views

**Dashboard** (`index.html`) — headline metrics, coverage by tactic and
platform, top gaps and opportunities, and orphaned records. With only a
library source it shows the research metrics alone. With a library and
published opportunities but no coverage of its own — the public library site —
it shows where opportunities exist, and never a coverage percentage.

**Techniques** (`techniques.html`) — a card per report, with its procedures and
their coverage, filterable by platform, tactic, recency, and coverage state.

**Records** (`records.html`) — a card per coverage record, filterable by
provider, platform, tactic, type, and status. Hidden when there is no coverage
source.

**Matrix** (`matrix.html`) — reports arranged by tactic in kill-chain order,
coloured by coverage state when coverage data is loaded.

## Repository layout

```
.
├── index.html, techniques.html, records.html, matrix.html
├── local/
│   ├── config.example.json     # copy to config.json and edit
│   └── README.md
├── data/                       # indexes for local sources
├── docs/
│   ├── DESIGN.md               # how it works, and why
│   └── DEPLOYMENT.md           # standing up your own
├── tools/sync_sources.py       # pulls local sources into data/
├── .github/workflows/
│   ├── sync-sources.yml        # scheduled pull
│   └── push-to-insomnia.yml    # reusable push, called by sources
├── css/
│   ├── insomnia.css
│   └── fonts/                  # self-hosted fonts and their licences
├── js/
│   ├── app.js                  # shared page setup: theme, header, banner
│   ├── data.js                 # load, validate, normalize, join
│   ├── metrics.js
│   ├── utils.js
│   └── dashboard.js, techniques.js, records.js, matrix.js
└── img/
```

Everything specific to a deployment lives in `local/` and `data/`, so pulling
updates from upstream does not conflict with what an instance owns.

## Development notes

- **No build step.** ES modules served as-is, over any local web server.
- **Self-hosted fonts.** IBM Plex Sans, IBM Plex Mono, and DM Serif Display
  are served from `css/fonts/` — see [css/fonts/README.md](css/fonts/README.md).
  The Tabler icon webfont loads from jsDelivr, which the CSP allows in
  `style-src` and `font-src`, and in `connect-src` for the stylesheet's source
  map, which browsers fetch while DevTools is open.
- **Strict Content-Security-Policy.** Scripts load only from the site itself;
  styles and fonts from the site and the icon CDN — no inline styles, no inline scripts. Style an element from
  script through its `.style` property, not a `style` attribute: the policy
  refuses the attribute silently. A `live` source must be on
  a host `connect-src` allows, which is `raw.githubusercontent.com`.

## Roadmap

- Trend "decay" view — flag procedures whose most recent record is more than N
  days old.
- Record drilldowns — a procedure opening a panel of the records referencing it.
- Views for validation and emulation sources.
- A scheduled snapshot of computed metrics, for trend history beyond what
  `pub_date` can reconstruct.
