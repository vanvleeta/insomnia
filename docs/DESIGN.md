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

A bare array is still accepted so a source that has not upgraded still loads,
but Insomnia warns: without the map its procedure IDs cannot be resolved.

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
once. At load it reports:

- **Conflicting platform maps.** If one source maps `Windows` to `WIN` and
  another to `WN`, procedure references between them cannot match. This is
  the failure that otherwise appears only as unexplained missing coverage.
- **Unsupported index schema**, newer than this build understands.
- **Pre-envelope sources**, whose platform short codes are unavailable.
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

Private sources are fetched through the Contents API with a GitHub App token.
Public sources are fetched from the raw URL with no credentials — an App token
is scoped to its installation and GitHub answers 404 outside it even for a
public repository, so sending one would break the fetch rather than help it.

The browser never fetches a source repository. It reads the synced copy under
`data/`, because a private repository cannot be fetched from a page at all,
and a public one would be a second copy of data the workflows already
maintain. `Repo` is used only to build links out to individual records, which
the viewer opens with their own credentials. Both commit only when data actually
changed, keeping history to the days something moved.
