# Deployment Guide

Standing up your own Insomnia, and keeping it current. Read
[Repository Design] first if you want to understand the pieces.

## Decide where it will be hosted, before anything else

**A deployment with a coverage source is as sensitive as that source.** The
assembled site maps what your organization can and cannot detect.

| Sources | Hosting |
|---------|---------|
| library only | Safe to publish. Public GitHub Pages is fine — this is the configuration that serves a public TRR library |
| any coverage source | Private only: Pages on a plan supporting private sites, or internal hosting of the built site |

Getting this wrong publishes your detection gaps. Decide it first.

## 1. Create the repository

Clone this repository and push it to your own, keeping `upstream` configured
so you can pull updates later:

```bash
git clone https://github.com/<template-org>/insomnia.git my-insomnia
cd my-insomnia
git remote rename origin upstream
git remote add origin https://github.com/<your-org>/my-insomnia.git
git push -u origin main
```

## 2. Configure your sources

```bash
cp local/config.example.json local/config.json
```

Each source needs a `Name`, a `Type`, and either a `Repo` or a `LocalPath`:

```json
{
  "schema": 1,
  "excludePlatforms": [],
  "sources": [
    { "Name": "TIRED Labs", "Type": "library",
      "Repo": "https://github.com/tired-labs/techniques" },
    { "Name": "ACME Coverage", "Type": "coverage",
      "Repo": "https://github.example.com/acme/coverage-records",
      "Branch": "main",
      "Load": "synced" }
  ]
}
```

**`Name` matters more than it looks.** It appears on every card, and both sync
workflows derive the data directory from it. Changing it later orphans the old
directory, which you would then delete by hand.

**`Type`** is one of `library`, `coverage`, `validation`, or `emulation`.
Validation and emulation are pulled but not yet displayed.

**`Load`** says where the source's index comes from:

| Value | Meaning | Use for |
|-------|---------|---------|
| `live` (default) | The browser fetches it directly | Public repositories on github.com |
| `synced` | The sync workflows bring it into `data/` | Private repositories, and anything on GitHub Enterprise |

A private repository **must** be `synced`: a browser cannot fetch it, and a
static page has nowhere safe to keep a token. Leaving one on `live` fails
loudly with a 404 in the load errors rather than quietly showing nothing.

An Enterprise source should be `synced` even when public. The page's
Content-Security-Policy only allows the browser to reach
`raw.githubusercontent.com`, and Insomnia warns at load if a `live` source is
anywhere else.

You never tell Insomnia whether a source needs a token. The sync tries without
one first and uses the App token only if that fails, so public sources work
whether or not a token is present.

**`excludePlatforms`** lists platforms your organization does not run. They are
dropped at load, so they disappear from views *and* from metrics — if you have
no AWS, AWS reports stop counting against your coverage.

```json
"excludePlatforms": ["AWS", "GCP"]
```

Use the display name exactly as the source writes it; matching is
case-insensitive.

### Optional: a site banner

An instance can show a banner under the header on every page — the public TRR
library explaining what the site is, or an internal deployment marking itself
confidential. Core ships none; add a `banner` block to your
`local/config.json`:

```json
"banner": {
  "title": "Technique Research Report (TRR) Library",
  "body": [
    "A paragraph. Inline links use [markdown syntax](https://example.com).",
    "Each string is its own paragraph."
  ],
  "links": [
    { "text": "Contribute", "href": "https://github.com/..." }
  ]
}
```

`body` accepts `[text](url)` links; `links` renders a row of buttons. Both
`title` and `body` are optional, but a banner with neither is not shown.

It is plain text, not HTML. The page's Content-Security-Policy forbids inline
styles, so pasted HTML would not render as intended anyway — and building it
from text means a banner cannot carry markup or script into the page. Only
`http(s)` and relative links are kept; anything else is dropped.

Because it lives in `local/config.json`, the banner is yours alone and never
conflicts with an upstream merge.

## 3. Set up the GitHub App

Sources live in other repositories, often private, so the workflow token
cannot reach them.

If every source is public, skip this section — no App is needed.

1. Create a GitHub App in your organization.
   - Uncheck **Webhook → Active**.
   - Grant **Repository permissions → Contents: Read and write**.
2. Generate a private key and download the `.pem`.
3. Install it on **each private source** and on **this one**. Public sources
   need nothing — the sync reaches them without credentials.
4. Add two secrets here under **Settings → Secrets and variables → Actions**:
   - `GH_APP_ID`
   - `GH_APP_PRIVATE_KEY`

Read access on sources and write access here is all it needs.

## 4. Pull your data

**If no source is `synced`, skip this section.** `live` sources are read
straight from the repository by the browser, so there is nothing to sync.

For `synced` sources, run **Sync source data** from the Actions tab. It fetches every configured
source into `data/<slug>/index.json` and commits only if something changed.

Locally:

```bash
GH_TOKEN=<a token with read access to your sources> \
  python3 tools/sync_sources.py
```

The script reports each source, its record count, and its index schema. A 404
almost always means the App is not installed on that source, or `index.json`
is not at the repository root.

After that, the workflow runs weekly on its own.

> [!NOTE]
>
> GitHub disables scheduled workflows in repositories with no activity for 60
> days. If data stops refreshing, check the Actions tab — re-enabling is one
> click.

## 5. Optional: push on merge

For data that arrives in seconds rather than by the next scheduled pull, have
each source call the reusable workflow when it merges:

```yaml
jobs:
  publish-to-insomnia:
    uses: <your-org>/my-insomnia/.github/workflows/push-to-insomnia.yml@main
    with:
      source-name: "ACME Coverage"     # must match Name in config.json
      insomnia-repo: "<your-org>/my-insomnia"
    secrets:
      app-id: ${{ secrets.GH_APP_ID }}
      private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}
```

`source-name` must match the `Name` in your config exactly, and that source
should be `Load: "synced"` — a push writes into `data/`, which is only read for
synced sources. Either mistake produces a directory nothing reads.

Push and pull are complementary. Both write the same place, so a pull after a
push is a no-op, and the schedule stays useful as a safety net for a source
whose push failed.

## 6. Publish the site

Insomnia is static — HTML, CSS, and JavaScript with no build step. Point Pages
at the repository root, or serve the directory from wherever you host.

Locally:

```bash
python3 -m http.server 8000
```

`file://` will not work: the browser blocks `fetch` of local files.

## Reading the warnings

Insomnia reports problems it can see that no single source can:

**Conflicting platform short codes.** Two sources mapping the same platform to
different codes means their procedure references cannot match. Fix the
`platforms` map in whichever source is wrong.

**A source using a pre-envelope index.** Its platform codes are unavailable,
so its procedure IDs may not resolve. Reindex that repository.

**An index schema newer than this build.** Update Insomnia.

**Orphaned records**, referencing procedures no configured library provides —
usually a missing library source, or a record pointing at a retired report.

## Keeping current

```bash
git fetch upstream
git merge upstream/main
```

Everything you own is in `local/` and `data/`, and the template ships nothing
in either beyond an example, so conflicts are rare.

[Repository Design]: ./DESIGN.md
