# Keepsake

Turn a folder of hundreds of photos into a printed photo book. Keepsake chooses the photos the way a careful person would, then designs the pages.

*A keepsake is something you keep to remember a moment. Choosing what is worth keeping is the main job of this skill.*

> **Not technical?** Start with the simple step-by-step guide for Claude and ChatGPT desktop users: **[English](docs/start-here.md)** · **[עברית](docs/start-here.he.md)**

## Why

Making the pages of a photo book is the easy part. The hard part is choosing: from 1,000 photos, which 40 are the best? The book should not show five photos of the same view, and every day of the trip should be in it. Keepsake does that work, and then lays out a modern book ready to print.

## How it works

```
your photos ─► 1. Clean out ─► 2. Pick ─► 3. Review ─► 4. Design ─► 5. Edit? ─► 6. Check ─► book PDF
               (script)        (script)   (agent)      (script)     (local UI)   (agent)
```

1. **Clean out** (`cull.mjs`) reads every photo. It removes blurry, dark and washed-out photos, screenshots, receipts and copies. It reads the date, the place and your own choices (star ratings, edited copies) from the photo files.
2. **Pick** (`pick.mjs`) groups shots of the same moment and keeps the best one. It splits the photos into chapters by day and place, and picks a varied set. It writes a first draft of the album and a few *decision sheets*: pictures that show many small photos at once, with codes.
3. **Review** — your AI agent looks at the decision sheets, not at every photo. It makes the calls a script can't: no street signs or strangers, the frame where eyes are open, the people who matter to you.
4. **Design** (`build.mjs`) makes crafted photo-first spreads: a strong main photograph and related supporting images, soft watercolor page washes, thin white photo borders on tinted pages, and subtle vector graphics (scroll flourishes, arrows, botanical sprigs, seam badges and optional script callouts). Reviewed subject rectangles prevent a sign or background from displacing the family in a crop.
5. **Edit (optional)** (`edit.mjs`) opens a local Storyboard. Reorder scenes, try safe layouts (including framed portrait + flourish, overlapping inset, and center-note mosaic), replace a photo, change page washes, add or move graphics/stickers, edit words, save, reopen and export through the same renderer.
6. **Check** — the agent looks at every page and fixes bad crops or weak photos.

**Quality defaults:** new drafts have no generated spread headings or slogans.
Washes, frames and subtle artwork remain. The planner can also use compatible
crafted layouts automatically. Photo similarity is only a proposal: the agent
reviews expressions and different groupings, keeps a selection log, and checks
actual PDF placement—not just browser screenshots.

## How it chooses like a person

- **Date and place.** The date and time come from the camera data in each photo. The town or neighbourhood comes from the GPS position, looked up in a built-in list of 171,000 places. Photos without GPS take the place of the nearest photo in time.
- **One photo per moment.** Shots taken within 10 minutes that look nearly the same are one *moment*: bursts, the same view zoomed in, a step to the side. Only the best frame goes in the book. Your edited copy, or a photo you rated with stars, is preferred over the original.
- **It knows what a photo shows.** A small AI model (CLIP) runs on your computer and reads each photo: a family, a street, a passport page, a screenshot. Photos of information, like passports, tickets, receipts and screenshots, are removed. It was built after a passport page slipped into a test book.
- **No repeats.** The model also tells how close two photos are in meaning, so the same scene counts as a repeat even when the colours differ. Each photo it picks pushes down every photo like it, even on other days.
- **It learns from you.** When you remove a photo and say why ("no passports"), Keepsake remembers it and skips photos like it in every future book. The memory holds no images.
- **A fair share for every day.** A day of eight rooftop views from different corners counts as about two scenes, so it gets fewer pages than a day full of different things.
- **The whole story.** For a trip, chapters follow the days. A day trip to another town gets its own chapter. For a year, chapters follow the months.

A test with known answers is part of the skill (`tests/`): a camera roll of 107 files with reshoots, bursts, an edited copy, a starred photo, a WhatsApp copy and junk. All 27 checks pass: one photo from each series of five reshoots, the sharp frame from every burst, the same view never picked twice, and every piece of junk removed. On a real 247-photo family trip to New York, it removed all four passport photos and a phone screenshot by itself.

## What you get

In `<your photos>-keepsake/book/`:

| File | What it is |
|---|---|
| `album.pdf` | A lighter reading copy with 180 dpi images, vector text and the front cover |
| `interior.pdf` | The inside pages, 30 × 30 cm, with 3 mm *bleed*: extra picture around the edge that the printer cuts off |
| `cover.pdf`, `cover-front.jpg` | The front cover |
| `report.md` | Print checks: page count, photos with low resolution, upload tips |
| `preview/spreads-*.jpg` | Every double page as a picture |
| `preview.html` | A scrollable preview of the whole album |
| `layout.json` | Crop coordinates, scene grouping and photo coverage for inspection |
| `../album.project.json` | Optional saved local-editor project, when the editor was used |

## Install

You need:
- Node.js 22.12 or newer
- Google Chrome, Microsoft Edge or Chromium, to make the PDF

Steps:
1. Put this repository in your agent's skills folder, in a folder named `keepsake`. For Claude Code, that is `~/.claude/skills/keepsake`; for Codex and GitHub Copilot, `~/.agents/skills/keepsake`:
   ```
   git clone https://github.com/asaf5767/keepsake ~/.claude/skills/keepsake
   ```
2. Install the scripts' libraries:
   ```
   cd ~/.claude/skills/keepsake/scripts
   npm install
   ```

Or paste the install message from the [simple guide](docs/start-here.md#step-4-install-keepsake-once) into your agent, and it does these steps for you.

## Use

Ask your agent with a local folder, a `.zip` file, or a shared link from **Google Photos**, **Apple Photos (iCloud)**, or **Google Drive**:

> Make a photo book from https://photos.app.goo.gl/...
> Make a photo book from https://www.icloud.com/sharedalbum/#...
> Make a photo book from https://drive.google.com/drive/folders/...
> Make a photo book from D:\Photos\Lisbon 2025

It asks a few questions (title, language, who matters most), downloads or unpacks the photos if you gave a link or `.zip`, runs the steps and shows you the result. Hebrew books are supported and read from right to left.

You can also run the scripts yourself, from the `keepsake` folder:

```
node scripts/cull.mjs "D:\Photos\Lisbon 2025"
node scripts/pick.mjs "D:\Photos\Lisbon 2025-keepsake"
```

Then copy `album.draft.json` to `album.json` in the `-keepsake` folder, edit it if you like, and build:

```
node scripts/build.mjs "D:\Photos\Lisbon 2025-keepsake\album.json"
```

Or open the optional local editor:

```
node scripts/edit.mjs "D:\Photos\Lisbon 2025-keepsake\album.json"
```

Its **Save** button writes `album.project.json`. Its **Export PDFs** button uses
that saved project with the normal print renderer. You can also export it from
the command line:

```
node scripts/build.mjs "D:\Photos\Lisbon 2025-keepsake\album.json" --project "D:\Photos\Lisbon 2025-keepsake\album.project.json"
```

`album.json` holds every choice: title, chapters, photos, cover, colours and book size. All options are in [references/album-json.md](references/album-json.md).
The optional saved page edits are described in [references/local-editor.md](references/local-editor.md).

For a designed book, group each chapter into scenes: breakfast, a playground visit, the fountain. Each scene gets one spread and one reviewed main photo. Mark the important region of people photos with `protect`, or use `fit: "contain"` to keep the complete original. The renderer uses the same crop rules when choosing a layout and when making the PDF.

The default chapter style is now `compact`. Set `chapterStyle` to `color`, `page` or `overlay` to retain an earlier design explicitly. Original photographs are not changed.

## Privacy

The scripts process photos locally and do not upload photos or GPS coordinates. The image model is downloaded from Hugging Face once and then runs locally. Contact sheets shown to a hosted AI agent are handled by that agent's provider; this review step is not an entirely offline workflow.

## Limits

- **No face recognition yet.** The agent asks who matters and checks faces on the decision sheets.
- **The model can be unsure.** Menus, signs and photos of screens sometimes get a `?` flag instead of being removed; the agent decides those.
- **Visual review is required.** Host image limits vary. Review sheets help with large collections, but important main photos and final crops still need to be inspected.
- **Phone favourites.** The heart (favourite) from a phone's gallery app is usually not saved inside the photo file. Star ratings from apps like Lightroom are.
- **iPhone HEIC photos** are converted automatically, but this has not been tested with real HEIC files yet.
- **Cover.** The cover file is the front only. For a hardcover, use your print service's cover template for the spine and back.
- **Local editor bookends.** The current editor freely changes scene spreads. Cover, opening and closing use the production templates; title, subtitle, paper and type still update them.

## Folder map

| Path | What it is |
|---|---|
| `SKILL.md` | Instructions for the agent |
| `references/album-json.md` | Every album option |
| `references/curation.md` | How the agent reviews photos |
| `scripts/cull.mjs` | Step 1: clean out |
| `scripts/pick.mjs` | Step 2: pick |
| `scripts/build.mjs` | Step 4: design and make the PDF |
| `scripts/edit.mjs` | Optional local Storyboard, save/reopen and PDF export |
| `scripts/editor-project.mjs` | Versioned saved-project contract and atomic revisions |
| `scripts/editor-server.mjs` | Tokenized loopback server for one work folder |
| `scripts/editor-layouts.mjs` | Photo-aware whole-spread layout choices |
| `scripts/editor-decor.mjs` | Watercolor page washes, vector graphics, badges and callout presets |
| `scripts/editor-placement.mjs` | Crop geometry shared by editor and renderer |
| `scripts/composition.mjs` | Shared subject-protected crop geometry for scoring and rendering |
| `editor/` | Storyboard browser UI |
| `scripts/places.mjs` | Offline place names |
| `scripts/vision.mjs` | The local AI model: what each photo shows |
| `scripts/taste.mjs` | Remembers photos you removed, for future books |
| `tests/` | Quality test with known answers |
| `assets/fonts/` | Montserrat and Heebo fonts |
| `assets/places/` | The place-name list |

Focused rendering checks:

```
node --test tests/composition.test.mjs tests/render.test.mjs
```

These cover protected subjects, full-frame fallback, scene boundaries, right-to-left layout, legacy styling and PDF page boxes. They do not replace looking at the finished album.

The complete production check, including saved projects, tokenized local-server
requests, save/reopen, browser editing and edited-PDF export, is:

```
npm test --prefix scripts
```

## License

Keepsake is free for personal and other noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Selling it, or using it in a paid product or service, needs permission from the author.

## Credits

- Place names: [GeoNames](https://www.geonames.org), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Fonts: Montserrat and Heebo, [SIL Open Font License 1.1](assets/fonts/)
- AI model: [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32) by OpenAI, run with Transformers.js
- Libraries: sharp, ExifReader, puppeteer-core, pdf-lib, heic-convert, @huggingface/transformers
