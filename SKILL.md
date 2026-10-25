---
name: keepsake
description: "Keepsake: turn a folder of hundreds of photos into a photo-first album. Review the best frame of each moment, avoid repeats, cover the story, and design large main photographs with tight supporting mosaics and subject-safe crops. Produces a reading PDF and separate print PDFs. Use for photo books, family yearbooks, album PDFs, or filtering a large photo folder down to the best."
---

# Keepsake

A folder of photos becomes `album.pdf` for reading, plus `interior.pdf` and `cover.pdf` for a printer whose specifications have been checked. The heart of the skill is **choosing photos like a person would**. The scripts propose candidates; you are the **editor** who reviews the photographs, chooses meaningful moments and safe crops. Deliver a working local Storyboard link alongside the PDF when running on the user's computer. Using the editor is optional; discovering it should not require another prompt.

`<skill>` below is this skill's folder. Needs Node 22.12+ and Chrome, Edge or Chromium (set `KEEPSAKE_CHROME` to the executable if it isn't found). If `<skill>/scripts/node_modules` is missing, run `npm install` in `<skill>/scripts` first.

## Image budget

Image budgets depend on the host. Review contact sheets first, then larger views of main-photo candidates when needed to judge focus and facial expressions. Reserve views for every final spread and the cover. If the viewer returns no image, stop and tell the user. Never report a visual check you did not see.

## Steps

1. **Brief.** Get what the user hasn't said, one question at a time: the photo source (a local folder, a `.zip` file, or a shared link from Google Photos, Apple iCloud Shared Albums, or Google Drive), the book title, the language, and who the important people are. Hebrew means `"direction": "rtl"`. For a folder that spans years, ask which year or dates the book covers.
   - Ask about the print size or printer before designing. For a digital-only book, offer the default 30 x 30 cm square. Do not claim a universal minimum page count; `minPages` and `pageMultiple` are targets for the chosen printer.
   - Keep printed spread headings off unless the user wants them. Use only supplied or confirmed wording. Do not infer relationships, identities, speeches or feelings from photographs. Plain dates are optional, not a repeated heading above every photo.
   *Done when* the source is known.

2. **Cull.** `node <skill>/scripts/cull.mjs "<folder-or-zip-or-link>"` (the work folder defaults to `<folder>-keepsake` next to a local folder/ZIP, or `<source>-keepsake` for cloud links; `--work <dir>` puts it elsewhere).
   - Accepts a local folder, a `.zip` archive, a **Google Photos** shared album link, an **Apple iCloud Shared Album** public link, or a **Google Drive** shared folder link. Links must already be accessible; never change sharing permissions for the user. These links expose photos to anyone who has the link. Downloaded files go into `<work>/photos`. Report the actual downloaded count, available resolution and missing dates. Do not promise original quality, preserved metadata or complete remote-album coverage without checking them.
   - `--recursive` if photos sit in subfolders. `--strict` for 500+ photos.
   - Place names come from a built-in offline list, so no location leaves the computer.
   - A small AI model (CLIP) reads what each photo shows, on this computer. The first run downloads it once (about 90 MB) into `<skill>/assets/model-cache`. Photos it is sure are information rather than moments (passports, tickets, screenshots, QR codes) are rejected; unsure ones get a `?` flag. `--no-ai` turns it off.
   - Photos like ones the user removed in earlier books are rejected too (see step 4, "Remember").

   Tell the user the counts: files, kept, rejected by reason, days, places, and owner signals (rated or edited photos). If the output says **Photo understanding: OFF**, tell the user that documents and screenshots may slip through, and look harder at the pick sheets.
   *Done when* `cull.json` exists in the work folder.

3. **Rescue.** View `sheets/rejected-01.jpg`. The rejects most likely to be mistakes come first: blurry, dark and washed-out shots. Then photos the model judged to be documents (`looks like: …`), then screenshots, then duplicates, whose best frame was kept. A night scene, a silhouette or intended motion blur is worth rescuing; add its `R…` code to the draft later.
   *Done when* the first rejects sheet has been viewed.

4. **Pick.** `node <skill>/scripts/pick.mjs "<work>"`. Add `--from`/`--to YYYY-MM-DD` for one trip or year from a bigger folder, `--photos N` for a different book size, or `--lang he`. It writes `album.draft.json` and decision sheets. Then review:
   - **`sheets/pick-*.jpg`**: per chapter, picked photos (green) and the bench (grey). Apply the checklist in [curation.md](references/curation.md): swap picks that are signs, screens, collages, photos of photos, or dominated by strangers, and swap in people the user cares about. A swap means replacing one code with a bench code in `album.draft.json`. A bench photo marked `≈ P012` repeats that pick, so swap it in only if it is clearly better.
   - **`sheets/frames-*.jpg`**: one row per picked moment with several frames; the chosen frame has a green outline. Prefer open eyes, smiles and an unblocked subject over technical sharpness. Change the code in the draft to the better frame.
   - **`sheets/more-*.jpg`**: review these when the draft misses an activity, an important person or enough distinct moments for the intended book. Similar backgrounds do not mean the same people are in each photograph.
   - Any photo labelled `? menu`, `? passport` and so on is one the model was unsure about. Decide each one; never leave it in by default.

   **Remember.** When the user removes a photo for a reason that will repeat ("no passports", "no photos of receipts"), save it: `node <skill>/scripts/taste.mjs "<work>" never <code> --note "<reason>"`. Future books then skip photos like it. `taste.mjs list` and `taste.mjs forget <n>` show and undo these. The memory lives in `~/.keepsake/taste.json` and holds no images.

   **Review tools.** `node <skill>/scripts/review.mjs "<work>"` creates legible sheets of all keepers and uncropped views up to 1800 px. Use `--codes P010,P012,P030` for specific candidates or rejected codes to rescue. Open the individual views to check faces and focus; making sheets does not count as viewing them. No ad-hoc sheet scripts are needed.

   A single-day celebration can be under-selected by the similarity score. If needed, rerun `pick.mjs --photos N` for a larger candidate pool, then review it; do not fill the book with duplicates to meet that number. Save `selection-log.json` in the work folder: selected codes, role, reason, evidence image viewed, plus swaps/removals and any uncertain dates or identities. Keep the initial draft so the changes remain explainable.

   *Done when* pick/frames sheets and needed alternatives were viewed, every main-photo candidate was inspected large, and the selection log explains the final choices.

5. **Story and design.** Read [design-quality.md](references/design-quality.md) and [album-json.md](references/album-json.md), then copy the draft to `album.json`. Preserve the compact, crafted style: large main photographs, tight mosaics, subtle washes and thin white frames. Start with `"showHeadings": false, "callouts": false`. These keep the photos and artwork, without invented slogans. Keep prior drafts and exports when revising.
   - Split each chapter into `scenes`: one activity or short sequence per two-page spread, usually 3-5 photos. Choose exactly one clear, meaningful photograph as `role: "main"`; use related supporting photos. A sharp background does not make an out-of-focus person a good main photo.
   - Review each main photo at sufficient size to see eyes and focus. Mark the important region in `photoSettings[code].protect` using normalized `[x, y, width, height]`. Include every important face and the body/objects that must remain visible. Mark photos of people with `subject: "people"` even when the model misclassified them.
   - A protected subject must fit the crop; otherwise the renderer keeps the whole image. Use `fit: "contain"` for a photo that must remain completely uncropped. Prefer a better-fitting photo/layout over shrinking people into tiny boxes.
   - Reserve separate photographs for the cover, opening and ending; do not reuse them in the scenes unless the user requests a callback. A collage cover needs three complementary, sharp images. A single-photo cover is valid when it is stronger. Do not add weak images merely to make a collage.
   - Check near-repeats visually across the whole book. Different combinations of people matter, but two versions of the same pose usually do not. Never tighten protection just to make a crop fill a box.
   - Rename approximate place labels and use only factual captions or the user's own notes. Do not invent personal memories.
   *Done when* every scene has a reviewed main photo, supporting photos belong to that scene, and people have safe framing instructions.

6. **Build.** `node <skill>/scripts/build.mjs "<work>/album.json"`; for revisions use a new `--out "<work>/book-v2"` folder.
   *Done when* it exits 0 and prints the page count.

7. **Prepare the editor handoff.** On the user's local computer, unless they explicitly want PDF only, run:
   ```
   node <skill>/scripts/edit.mjs "<work>/album.json" --port 0 --no-open
   ```
   Run it as a persistent background process using the host's supported lifecycle (detached if required, with approval). If the build used a custom output folder, pass that same `--out`. Verify the exact printed URL returns HTTP 200. Keep the process running and provide that full URL, including its token, as a clickable **Edit your album** link. Do not launch only to create a project and then kill it.

   The first launch writes `<work>/album.project.json`. This is the saved editor project, not generated evidence. **Save** writes it atomically; **Export PDFs** saves first and calls the same production renderer. To export without reopening the browser:
   ```
   node <skill>/scripts/build.mjs "<work>/album.json" --project "<work>/album.project.json"
   ```
   The project must still match the album's scenes, photos and print geometry. If those structural parts of `album.json` change, make a new project instead of silently applying old page edits. See [local-editor.md](references/local-editor.md).

   For project creation without a web server, use `--prepare-only`. Modify existing projects through the UI/API or `saveEditorProject`; never invent revisions or overwrite unsaved edits. Keep prior projects if structural changes require a new one.

   A remote/web sandbox's `127.0.0.1` is not the user's computer. Use an approved preview tunnel if available; otherwise deliver the project and clearly state that the live editor is unavailable. Never present a dead or unreachable link as working.
   *Done when* a reachable editor URL is ready to hand over, or a concrete environment limitation is stated.

8. **Proof.** View every spread and cover, read the full report, and inspect the **actual PDF**, not only HTML screenshots. Check every page's size and rasterize representative PDF pages, including a decorated/editor spread, to verify image scale and placement. If PDF rendering tools are unavailable, disclose that the PDF's visual proof is incomplete. Inspect the latest saved export. Fix in one batch, confirm once; do not run an endless polish loop.
   - a `FAIL` resolution line: swap the photo, or take it off a full page
   - a crop that cuts off a head or important subject: correct `protect`, use `fit: "contain"`, or choose a different layout
   - a weak or blurry main photograph: replace it, not just its crop
   - a large empty band or tiny people: use a taller layout, a closer photo or a tighter subject-safe crop
   - unrelated moments on one spread: split the scene
   - a page-count warning: add meaningful scenes or adjust the printer target; never fill the count with blank dividers

   *Done when* the last build was visually reviewed, the PDF composition matches the previews, and unresolved size/crop/page-count warnings are fixed or explicitly accepted. Exit code 0 alone is not a pass.

9. **Deliver.** Attach `album.pdf` and show the verified **Edit your album** link in the same reply. State the actual trim size and interior page count. Identify `interior.pdf` and `cover.pdf` as print components, subject to the printer's specifications. Preserve `album.project.json`, the selection log and previous outputs. State unresolved crop, resolution or printer requirements and distinguish script processing from visual review. On hosts that cannot attach workspace files, copy deliverables into the session's attachment area rather than returning only a local path.

## Sheet labels

- **P012** is a kept photo, **R004** a rejected one. Use these codes in album.json.
- `✓` picked, `bench` next in line, `+3` the moment has 3 more frames on the frames sheet.
- `≈ P012` looks like a picked photo: a near-repeat.
- `? passport`, `? menu`… the model thinks this may be information, not a moment. Check it.
- `♥` rated 3+ stars, `edit` the owner's edited copy, `selfie` front camera, `recv` received from someone else (WhatsApp or Telegram).
- On the rejects sheet, each photo shows its reason (`blurry`, `too dark`, `screenshot`…) or `dup of P012` for a frame of a kept photo.

## How the picking works (so you can explain it)

- **Reading the files:** date and time from the camera's EXIF data; the town or neighbourhood and country from GPS, looked up offline. Photos without GPS borrow the place of the nearest photo in time. Star ratings, edited copies (`IMG_E…`), the front camera and WhatsApp copies come from the file data and names.
- **What a photo shows:** the CLIP model compares each photo with short descriptions ("a passport page", "a family photo", "a city street") and gives each a likelihood. That is how documents and screenshots are caught, and it also gives each photo a *meaning vector*: a list of numbers that is close for photos showing the same thing.
- **Moments:** shots taken within 10 minutes that look nearly the same, including bursts, reframed shots and the same scene from one step to the side, form one moment. With the model on, they must also *mean* nearly the same, so a long photo session in one park splits into its real moments. The best frame stands for it: sharpest and best exposed, though the owner's edited or starred version is preferred.
- **Looking alike** uses the meaning vectors when the model is on. Without it, three fingerprints: a 4×4 map of average colours (it survives zooming and reframing), the colour palette, and the light-dark structure.
- **Chapters:** days for a trip, with a second chapter when the day moves more than 20 km, such as a day trip to another town. Months for a year, years for longer. Photos before 4 a.m. count as the night before.
- **How many:** the book size follows the number of *distinct* scenes, not the photo count. Each chapter gets a share that grows with its distinct scenes, so a day of eight rooftop views from different corners counts about as much as a day with two different things. Every day of a trip gets at least 5 photos (3 for a month or year), however alike they look.
- **Which ones:** inside a chapter, moments are taken best-first, but each one already picked pushes down everything that looks like it, in this chapter and slightly in others. The result is the strongest photos that are not repeats of each other.

## What the build decides

- `compact` is the default. It keeps scene boundaries and approved main photos, and scores layouts using the same protected crop geometry that exports the JPEGs. Familiar layouts may repeat; variation is not a goal by itself.
- It uses large photographs, aligned grids, compact headings, optional folios, a photo-led cover and a photographic ending. It does not add empty divider pages to meet a target page count.
- Explicit `color`, `page` and `overlay` chapter styles retain the earlier design for users who ask for it.
- It writes `layout.json` with actual crop coordinates and photo coverage, a combined reading PDF, separate print PDFs with exact trim/bleed boxes, and an HTML preview. High DPI alone does not prove good focus, composition or printer acceptance.
- With `--project`, the renderer uses the saved spread order, stable frame/text IDs, millimetre boxes, photo replacements and wording. `layout.json` records the project ID and revision that produced the PDFs.
