---
name: keepsake
description: "Keepsake: turn a folder of hundreds of photos into a photo-first album. Review the best frame of each moment, avoid repeats, cover the story, and design large main photographs with tight supporting mosaics and subject-safe crops. Produces a reading PDF and separate print PDFs. Use for photo books, family yearbooks, album PDFs, or filtering a large photo folder down to the best."
---

# Keepsake

A folder of photos becomes `album.pdf` for reading, plus `interior.pdf` and `cover.pdf` for a printer whose specifications have been checked. The heart of the skill is **choosing photos like a person would**. The scripts measure and group photos; you are the **editor** who chooses the important moments, the main photograph of each scene, and safe crops. After the first design, an optional local Storyboard lets the user change the book before exporting it again.

`<skill>` below is this skill's folder. Needs Node 22.12+ and Chrome, Edge or Chromium (set `KEEPSAKE_CHROME` to the executable if it isn't found). If `<skill>/scripts/node_modules` is missing, run `npm install` in `<skill>/scripts` first.

## Image budget

Image budgets depend on the host. Review contact sheets first, then larger views of main-photo candidates when needed to judge focus and facial expressions. Reserve views for every final spread and the cover. If the viewer returns no image, stop and tell the user. Never report a visual check you did not see.

## Steps

1. **Brief.** Get what the user hasn't said, one question at a time: the photo folder, the book title, the language, and who the important people are. Hebrew means `"direction": "rtl"`. For a folder that spans years, ask which year or dates the book covers.
   *Done when* the folder exists and holds images.

2. **Cull.** `node <skill>/scripts/cull.mjs "<folder>"` (the work folder is `<folder>-keepsake`, next to the photos; `--work <dir>` puts it elsewhere).
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
   - **`sheets/more-*.jpg`**: everything else. Open these only when the user names a moment the picks miss.
   - Any photo labelled `? menu`, `? passport` and so on is one the model was unsure about. Decide each one; never leave it in by default.

   **Remember.** When the user removes a photo for a reason that will repeat ("no passports", "no photos of receipts"), save it: `node <skill>/scripts/taste.mjs "<work>" never <code> --note "<reason>"`. Future books then skip photos like it. `taste.mjs list` and `taste.mjs forget <n>` show and undo these. The memory lives in `~/.keepsake/taste.json` and holds no images.

   *Done when* every pick and frames sheet has been viewed and the draft reflects your swaps.

5. **Story and design.** Copy the draft to `album.json` and finish it ([album-json.md](references/album-json.md)). Use the default `compact` design: white pages, large main photographs, thin-gap mosaics and small headings. Preserve the old output when revising a book.
   - Split each chapter into `scenes`: one activity or short sequence per two-page spread, usually 3-5 photos. Choose exactly one clear, meaningful photograph as `role: "main"`; use related supporting photos. A sharp background does not make an out-of-focus person a good main photo.
   - Review each main photo at sufficient size to see eyes and focus. Mark the important region in `photoSettings[code].protect` using normalized `[x, y, width, height]`. Include every important face and the body/objects that must remain visible. Mark photos of people with `subject: "people"` even when the model misclassified them.
   - A protected subject must fit the crop; otherwise the renderer keeps the whole image. Use `fit: "contain"` for a photo that must remain completely uncropped. Prefer a better-fitting photo/layout over shrinking people into tiny boxes.
   - Use a strong family portrait with two supporting images for the collage cover. Finish with an actual photograph, not a circle index. Avoid repeating near-identical group poses within the interior.
   - Rename approximate place labels and use only factual captions or the user's own notes. Do not invent personal memories.
   *Done when* every scene has a reviewed main photo, supporting photos belong to that scene, and people have safe framing instructions.

6. **Build.** `node <skill>/scripts/build.mjs "<work>/album.json"`
   *Done when* it exits 0 and prints the page count.

7. **Edit locally (optional).** When the user wants direct control, run:
   ```
   node <skill>/scripts/edit.mjs "<work>/album.json"
   ```
   It opens a local Storyboard on `127.0.0.1`. The user can reorder scenes, choose a safer whole-spread layout, replace photographs, edit wording, move or resize objects, add text, change paper/type, mark spreads reviewed, save, close, reopen and export PDFs. The original photographs are read-only.

   The first launch writes `<work>/album.project.json`. This is the saved editor project, not generated evidence. **Save** writes it atomically; **Export PDFs** saves first and calls the same production renderer. To export without reopening the browser:
   ```
   node <skill>/scripts/build.mjs "<work>/album.json" --project "<work>/album.project.json"
   ```
   The project must still match the album's scenes, photos and print geometry. If those structural parts of `album.json` change, make a new project instead of silently applying old page edits. See [local-editor.md](references/local-editor.md).

   The editor is optional. Skip this step for the normal agent-reviewed workflow.
   *Done when* the UI says the project is saved, and an export (when requested) reports the same saved revision.

8. **Proof.** View every `book/preview/spreads-*.jpg` and `book/cover-front.jpg`, then read `book/report.md`. If the editor was used, proof the output from its latest saved export. Edit the project in the UI, or edit album.json and start a new project, when you see:
   - a `FAIL` resolution line: swap the photo, or take it off a full page
   - a crop that cuts off a head or important subject: correct `protect`, use `fit: "contain"`, or choose a different layout
   - a weak or blurry main photograph: replace it, not just its crop
   - a large empty band or tiny people: use a taller layout, a closer photo or a tighter subject-safe crop
   - unrelated moments on one spread: split the scene
   - a page-count warning: add meaningful scenes or adjust the printer target; never fill the count with blank dividers

   *Done when* every spread from the **last** build has been viewed and the report has no `FAIL`.

9. **Deliver.** Attach or link `album.pdf` directly, not just the containing folder. It includes the cover. Present `preview.html` for browsing and identify `interior.pdf` plus `cover.pdf` as the separate print components. If the local editor was used, also preserve `album.project.json` so the book can be reopened. State unresolved crop, resolution or printer requirements. Distinguish algorithmic processing from photographs actually reviewed. If the editor was not used, tell the user in plain words that they can say "open the editor" to change photos, layouts and text themselves. Many users are not technical: name files and next steps simply, without commands.

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
