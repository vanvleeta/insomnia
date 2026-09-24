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
      "Private": true }
  ]
}
```

**`Name` matters more than it looks.** It appears on every card, and both sync
workflows derive the data directory from it. Changing it later orphans the old
directory, which you would then delete by hand.

**`Type`** is one of `library`, `coverage`, `validation`, or `emulation`.
Validation and emulation are pulled but not yet displayed.

**`Private`** marks a source whose index needs a token to fetch. Leave it off
for public repositories.

This is not an optimization — it is required. A GitHub App token is scoped to
the repositories the App is installed on, and GitHub answers 404 for anything
outside that installation *even when the repository is public*. Sending a
token to a public source therefore breaks it. Public sources are fetched from
the raw URL with no credentials; private ones go through the Contents API with
the App token.

You also cannot install an App on a repository you do not control, so a public
upstream library can only ever be fetched unauthenticated.

**`excludePlatforms`** lists platforms your organization does not run. They are
dropped at load, so they disappear from views *and* from metrics — if you have
no AWS, AWS reports stop counting against your coverage.

```json
"excludePlatforms": ["AWS", "GCP"]
```

Use the display name exactly as the source writes it; matching is
case-insensitive.

## 3. Set up the GitHub App

Sources live in other repositories, often private, so the workflow token
cannot reach them.

If every source is public, skip this section — no App is needed.

1. Create a GitHub App in your organization.
   - Uncheck **Webhook → Active**.
   - Grant **Repository permissions → Contents: Read and write**.
2. Generate a private key and download the `.pem`.
3. Install it on **each private source** and on **this one**. Public sources
   need nothing.
4. Add two secrets here under **Settings → Secrets and variables → Actions**:
   - `GH_APP_ID`
   - `GH_APP_PRIVATE_KEY`

Read access on sources and write access here is all it needs.

## 4. Pull your data

Run **Sync source data** from the Actions tab. It fetches every configured
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

`source-name` must match the `Name` in your config exactly, or the push writes
to a directory nothing reads.

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
