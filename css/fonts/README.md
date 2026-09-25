# Self-hosted fonts

Served from this site rather than from Google Fonts, for two reasons:

- **The Content-Security-Policy.** `style-src` and `font-src` allow only this
  origin and the icon CDN. The Google Fonts stylesheet this replaced was
  always refused, so these faces never loaded and every visitor saw fallback
  fonts.
- **Privacy.** A Google Fonts request sends each visitor's IP address to a
  third party on every page load.

| File | Family | Weight |
|------|--------|--------|
| `ibm-plex-sans-latin-400-normal.woff2` | IBM Plex Sans | 400 |
| `ibm-plex-sans-latin-500-normal.woff2` | IBM Plex Sans | 500 |
| `ibm-plex-sans-latin-600-normal.woff2` | IBM Plex Sans | 600 |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono | 400 |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono | 500 |
| `dm-serif-display-latin-400-normal.woff2` | DM Serif Display | 400 |

Only the weights the pages actually render are included — checked by
walking every text element on every page — in the Latin
subset. Add a weight here and a matching `@font-face` rule if the CSS starts
asking for one; an unmatched weight is synthesized by the browser rather than
failing, so it is easy to miss.

## Source and licence

From Fontsource `@fontsource/*` 5.3.0, which repackages the upstream releases.
All three families are licensed under the SIL Open Font License 1.1, which
permits redistribution provided the licence accompanies the fonts — hence the
`LICENSE-*.txt` files alongside them.
