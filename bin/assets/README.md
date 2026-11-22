# Bundled font

Vazir 30.1.0 is bundled for Persian and English text.

- `Vazir-Regular.woff2`: embedded in the app payload, without downloading.
- `Vazir-Regular.ttf` and `Vazir-Bold.ttf`: registered only within the installer process, without system-wide installation.
- `Vazir-OFL.txt`: the complete SIL Open Font License 1.1 and copyright notice.

Files are unchanged from the [official source](https://github.com/rastikerdar/vazirmatn/tree/v30.1.0).

## Rasta brand assets

`rasta-mark.svg` defines the fixed Rasta logo. Its square tile is black
(`#000000`) and its three right-aligned strokes are white (`#FFFFFF`). The native
`drawBrand` function renders the same geometry for every macOS icon size.
The main Library header uses the glyph with the existing appearance tokens.
