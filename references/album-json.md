# album.json

Lives in the work folder next to `cull.json`. `pick.mjs` writes a first version as `album.draft.json`; copy it to `album.json` and edit it. Photos are referenced by sheet code (`P012`, or a rescued `R004`) or by file name.

```json
{
  "title": "Lisboa",
  "subtitle": "Four days by the Tagus",
  "author": "Assaf",
  "chapterStyle": "compact",
  "cover": { "photos": ["P012", "P018", "P038"] },
  "titlePage": { "photo": "P024" },
  "photoSettings": {
    "P008": { "subject": "people", "protect": [0.12, 0.25, 0.76, 0.65] },
    "P003": { "subject": "people", "fit": "contain" }
  },
  "chapters": [
    {
      "title": "Baixa & Alfama",
      "kicker": "Saturday, 10 May",
      "scenes": [
        {
          "title": "A morning in Alfama",
          "photos": [{ "id": "P008", "role": "main" }, "P003", "P004"]
        },
        {
          "title": "By the water",
          "photos": [{ "id": "P001", "role": "main" }, "P020", "P021"]
        }
      ]
    }
  ],
  "closing": { "photo": "P047", "text": "Optional last line." }
}
```

## How a book is built

- **Page 1** is the title page.
- **Compact is the default.** Small headings share pages with photographs. No routine colour divider pages, narrow photo bands or circular chapter index are added.
- **Scenes** are the preferred input: 2-10 related photos per scene, one scene per two-page spread. Choose a reviewed main photo with `role: "main"`. The renderer cannot move photos into another scene.
- **Automatic input still works.** Use `chapter.photos` instead of `chapter.scenes` when you want the planner to divide that chapter into spreads. Never use both fields in the same chapter.
- **Layout follows the photographs.** Large main photos face aligned mosaics; two-photo and two-grid spreads are also supported. Repetition is allowed. Incompatible crops are not chosen just to make a new-looking layout.
- **The local editor is optional.** After the first build, `node scripts/edit.mjs album.json` can save exact manual spread edits in `album.project.json`. The manifest remains the story and print intent; the project remains the manual page description.
- **Crops protect subjects.** The scorer and renderer use the same reviewed `protect` rectangle. When it cannot fit, the full photograph is shown. Unannotated photos identified as people are conservatively kept whole.
- **The last page** uses `closing.photo`, or the last selected photograph if none is supplied. A short optional line is placed below it.
- Small page numbers sit at the outer bottom corners: the book title on left pages and the chapter title on right pages. They are left off full-bleed pages.

## Book fields

| Field | Default | Meaning |
|---|---|---|
| `title`, `subtitle`, `author` | — | Title page and cover. `subtitle` falls back to the date range. |
| `dates` | from EXIF | Overrides the date line ("10 May – 13 May 2025"). |
| `theme` | `white` | `white`, `cream` or `dark`: page and gap colour. |
| `chapterStyle` | `compact` | Photo-first layouts with small headings. Explicit `color`, `page` and `overlay` retain the earlier designs. Scenes require `compact`. |
| `accent` | from photos | Accent for legacy colour styles. The compact design uses neutral type on white by default. |
| `density` | `balanced` | Automatic planning target: `airy` about 2.5, `balanced` about 4.5, `full` about 7 photos per spread. Explicit scenes already determine grouping. |
| `direction` | `ltr` | `rtl` for Hebrew books: the book opens from the right, and pages, grids and text are mirrored. Hebrew text uses Heebo automatically. |
| `locale` | `en-GB`, or `he-IL` when rtl | Date language. |
| `trimMm` | `300` | Square trim size. For other shapes use `trimWidthMm` + `trimHeightMm`. |
| `bleedMm` | `3` | Added on every side. Set `0` if the service wants pages without bleed. |
| `marginMm` | `12` | White border around grid pages, from the trim edge. |
| `bindingMm` | `3` | Extra margin on the binding side of every grid page. |
| `gutterMm` | `3` | Gap between photos. |
| `folios` | `true` | Page numbers. `false` turns them off. |
| `layflat` | `false` | Controls fold-spanning photo preferences in legacy layouts. Compact scenes keep each photograph on one page. |
| `minPages` | `24` | Printer target. Compact mode warns when short; it does not insert empty filler pages. Add meaningful scenes or choose a suitable printer target. |
| `pageMultiple` | `2` | An even multiple; some printers require 4. Compact mode reports a mismatch instead of silently padding. |
| `cull` | `cull.json` | Path to the cull output, relative to album.json. |
| `order` | `date` | Photos in each chapter are sorted by date, so codes can be added anywhere in a chapter's list. `as-listed` keeps your order instead. |
| `photoSettings` | none | Per-photo framing settings shared by cover, interior and ending. Item-level settings override them. |

## Cover

- `"cover": { "photo": "P012" }`: a dominant photograph with a compact title on white in compact mode.
- `"cover": { "photos": ["P012", "P018", "P038"] }`: a large main photo and two supporting images beside the title. Exactly three images; the first is the main one.
- `style: "collage"` explicitly selects that three-photo cover. `style: "grid"` retains the earlier 2x2 cover; `style: "color"` retains the colour-block cover.
- `"cover": { "photo": "P018", "style": "full", "focus": "50% 60%" }`: one full-bleed photo with the title in white. It needs a high-res photo with a calm area at the bottom.
- `accent` on the cover overrides its colour.

`cover.pdf` is the front cover only. A hardcover wrap and spine come from the print service's template.

## Title page

- `"titlePage": { "photo": "P024" }`: one framed photo with the title below it.
- `"titlePage": { "photos": [3 codes] }`: a 2×2 grid with the title in one box.
- Leave it out for a big title on white.

Title-page and cover photos may also appear inside the book.

## Chapter fields

| Field | Meaning |
|---|---|
| `title` | Chapter title. Keep it short: a place, a month or an event. |
| `kicker` | Small line above the title, usually the date. |
| `note` | Legacy chapter styles use this for a title-page or grid note. Compact scenes use concise scene titles and photo captions instead. |
| `accent` | Overrides this chapter's colour, e.g. `"#7a3b2e"`. |
| `photos` | Automatic chapter planning, sorted by date unless `order` overrides it. |
| `scenes` | Compact mode only. Array of `{ "title": "...", "photos": [...] }`. Each scene makes one spread with 2-10 related photos. Use instead of `photos`. |

## Photo items

A plain string is a normal photo; the planner decides where it goes. An object adds options:

| Key | Meaning |
|---|---|
| `role: "main"` | A reviewed main photograph that gets its own large placement. Use one per explicit scene. |
| `role: "support"` or `"detail"` | Never promoted to the large main-photo slot. |
| `hero: true` | Legacy full-page instruction. In compact mode it is treated as a main-photo request, with safe fallback rather than a forced unsafe crop. |
| `hero: "spread"` | Legacy layouts only: photo across both pages, for lay-flat binding. |
| `solo: true` | Alone on a page, whole and uncropped, with white around it. |
| `break: true` | Start a new spread at this photo, e.g. where morning turns into evening. |
| `focus: "x% y%"` | What to keep when cropping: `"0% 50%"` keeps the left edge, `"50% 30%"` the upper middle. |
| `caption` | Small text: under a framed photo, or in white on a grid photo wider than 6 cm or on a full page. |
| `protect: [x,y,w,h]` | Subject rectangle in the oriented original, using fractions from 0 to 1. Every marked face/body/object stays in the crop; if that is impossible, the full image is shown. |
| `subject: "people"` | Treat the photo as containing people even if the classifier missed them. Without `protect`, keep the complete frame. |
| `fit: "contain"` | Always show the entire image. |

The editor supplies `protect` after looking at the photo. These are framing instructions, not face recognition. For example, `[0.1, 0.25, 0.8, 0.65]` protects a rectangle starting 10% from the left and 25% from the top, extending 80% of the image width and 65% of its height. `focus` chooses a crop position only within that safety constraint.

## Outputs

- `album.pdf`: lighter reading copy with 180 dpi images, vector text, the front cover included and bleed hidden. Print images in the separate components remain full resolution.
- `interior.pdf`, `cover.pdf`: print components with exact trim/bleed boxes. Printer acceptance still needs confirmation against its template.
- `preview.html`: complete scrollable local preview.
- `preview/spread-NN.jpg`: individual spreads; `preview/spreads-NN.jpg`: proof sheets.
- `layout.json`: scene boundaries, placements, crop coordinates and photographic coverage.
- `album.project.json` (next to this file, only when the local editor is used): stable editable spread/frame/text objects. It is an input to `build.mjs --project`, not generated proof.
- `report.md`: page count, resolution, layout and printer warnings.
