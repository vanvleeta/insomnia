# Instance-specific content

`config.json` here describes **this deployment**: which sources it reads and
which platforms it excludes. The template ships only `config.example.json`, so
pulling updates from upstream never conflicts with what you own.

Copy the example to start:

```bash
cp local/config.example.json local/config.json
```

See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) for the full setup and
[../docs/DESIGN.md](../docs/DESIGN.md) for how sources are joined.

`data/` is the other instance-owned directory: it holds the indexes pulled
from your sources and is written by the sync workflows, never by hand.
