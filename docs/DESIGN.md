# Repository Design

Insomnia is the dashboard for the TIRED Labs ecosystem. It reads the indexes
published by other repositories, joins them, and presents technique research
alongside the coverage an organization has against it.

## Where this repo fits

- **TRR libraries** hold Technique Research Reports: how an attack technique
  works, the procedures that make it up, and the detection data models that
  describe the evidence it leaves. A TRR describes the technique and says
  nothing about any particular organization.
- **Coverage record libraries** track what an organization detects or
  prevents, and where it has gaps. They are private by definition.
- **Insomnia** (this repository) reads any number of both and joins them on
  procedure IDs.

Insomnia owns no records. Everything it displays comes from a source, and it
is the only component that sees more than one repository at a time.

## Sensitivity

**A deployment with a coverage source is as sensitive as that source.** The
assembled site is a map of what an organization can and cannot detect, which
is exactly what an attacker would want.

A library-only deployment is safe to publish — that is the configuration that
serves a public TRR library. Any deployment with a coverage source belongs on
private hosting: GitHub Pages on a plan supporting private Pages, or internal
hosting of the built site.

## Configuration

Everything specific to a deployment lives in `local/config.json`, matching the
convention the record repositories use: the template ships nothing under
`local/` but an example, so pulling updates never conflicts with what an
instance owns.

```json
{
  "schema": 1,
  "excludePlatforms": ["AWS"],
  "sources": [
    { "Name": "TIRED Labs", "Type": "library",
      "Repo": "https://github.com/tired-labs/techniques" },
    { "Name": "ACME Coverage", "Type": "coverage",
      "Repo": "https://github.example.com/acme/coverage-records" }
  ]
}
```

### Source types

| Type | Read today | Purpose |
|------|-----------|---------|
| `library` | yes | Technique research; supplies procedures |
| `coverage` | yes | Coverage and gap records; joined onto procedures |
| `validation` | no | Reserved for Vigil |
| `emulation` | no | Reserved for emulation results |

Validation and emulation sources are configured and pulled but not yet
consumed. Having the data present is what lets a view be added later without
also changing the transport.

### Platform exclusions

`excludePlatforms` drops records at load rather than hiding them at render, so
metrics reflect the estate an organization actually runs. Excluding AWS
removes AWS reports from every view and from every score.

A coverage record referencing only excluded procedures is reported as
**excluded**, not orphaned. Removing a platform should not invent a pile of
data-quality problems that did not exist.

## The index contract

Every source publishes `index.json` as an envelope:

```json
{
  "schema": 2,
  "generated": "2026-09-22T14:03:00Z",
  "platforms": { "Active Directory": "ad", "Windows": "win" },
  "records": [ ... ]
}
```

`schema` lets Insomnia decide whether it understands the file instead of
inferring that from its shape. `generated` is when the source last wrote its
index, which is real freshness rather than the time this page happened to
fetch. `platforms` is copied verbatim from the source's own configuration.

That platform map is what makes the join work. A procedure ID embeds a
platform short code — `TRR0030.WIN.A` — and without the map Insomnia would
have to guess the code from the display name. It used to, and the guess was
wrong for anything unusual, producing IDs that silently failed to match.

Nothing is guessed. A record whose platform is not defined in **its own
source's** map is skipped and reported, and an index that is a bare array or
has no proper platform map is rejected outright. A short code is never
borrowed from another source either: that would hide the fact that this
source's index is incomplete. Failing loudly is the point — a source whose
platforms cannot be resolved produces procedure IDs that silently fail to
match, which reads as missing coverage rather than as a problem with the data.

## The model

A report is keyed by **ID and platform**, not ID alone. A report covering two
platforms publishes one index record per platform folder, and keying by ID
dropped one of them silently — along with its procedures, its contribution to
the metrics, and its correlation with coverage.

```
trrs          Map<"TRR0033.AZR", TRR>
procedures    Map<"TRR0033.AZR.A", Procedure>
records       Map<"PCR0010", Record>
recordsByProc Map<ProcID, Record[]>       the join
platforms     Map<Name, ShortCode>        union across sources
```

Each procedure carries `trrKey`, so a lookup resolves to exactly one report.

Coverage records nest their provider-specific fields under `provider_details`,
so every coverage record has the same shape regardless of which system
supplies the coverage. `provider` names that system and is shown on each card
and offered as a filter.

## Cross-source validation

Each source validates its own records; nothing but Insomnia can see two at
once. At load it reports the following, at the top of every page:

- **Conflicting platform maps.** If one source maps `Windows` to `WIN` and
  another to `WN`, procedure references between them cannot match. This is
  the failure that otherwise appears only as unexplained missing coverage.
- **Unsupported index schema**, newer than this build understands.
- **Undefined platforms** — records naming a platform their own index
  does not define. Skipped and listed, one error per source.
- **Orphaned records**, referencing procedures no library provides.

## Getting data in

Two complementary workflows, both writing to `data/`:

**`sync-sources.yml`** runs weekly and pulls every configured source. One
place describes what a deployment reads, and adding a source means editing
`local/config.json` rather than any workflow.

**`push-to-insomnia.yml`** is a reusable workflow a source repository calls on
merge, so its index arrives within seconds. Both derive the target directory
from the source Name the same way, so a push and a pull write to the same
place rather than creating two copies.

Each source sets `Load`, naming where its index comes from rather than how
visible its repository is — the two are independent, and a public repository
can reasonably be synced:

| `Load` | Browser reads | Sync pulls it |
|--------|---------------|---------------|
| `live` (default) | the repository's raw URL, directly | no |
| `synced` | the copy under `data/<slug>/` | yes |

A browser cannot fetch a private repository and has nowhere safe to keep a
token, so private data must be `synced`. Public data can be either, and a
library-only deployment — the configuration serving a public TRR library —
works with no workflow configured at all.

The sync decides for itself whether it needs credentials. It fetches the raw
URL with none first, and retries through the Contents API with the App token
only if that fails. A public repository therefore never has the token sent to
it — which matters, because GitHub answers 404 when an App token is sent to a
repository outside the App's installation, even a public one. That behaviour is
why no per-source auth setting is needed.

A `live` source must be on a host the page's Content-Security-Policy allows,
which is `raw.githubusercontent.com`. Insomnia warns at load when one is not,
so the browser's refusal comes with its cause attached. An Enterprise source
should be `synced`, which also avoids the instance's SSO and CORS rules.

`Repo` always builds the links out to individual records, which the viewer
opens with their own credentials. Both commit only when data actually
changed, keeping history to the days something moved.
