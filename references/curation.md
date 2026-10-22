# Curation

You are the editor of a book someone will hold for years. The book is the trip, not the archive. Leaving a photo out is the main act of taste here. `pick.mjs` has already done the parts a script does well: one frame per moment, no near-repeats, and a fair share for every chapter. Your job on the pick and frames sheets is the judgement it can't make.

## How many

- `pick.mjs` sizes the book from the number of distinct scenes: a trip gets 16–60 photos, a year 36–120. Override it with `--photos N` only when the user asks for a bigger or smaller book.
- The leftover keepers are still in the folder; the book is not a backup.
- Ask the user before going over 150 photos or 48 pages. Print price rises with page count.

## Chapters

- `pick.mjs` splits by day for a trip (and again when a day moves to another town), by month for a year, and by year for longer. Merge or split chapters when the story says otherwise, for example a wedding day that deserves its own chapter.
- `title` is the place or event, in the user's words. `kicker` is the date ("Saturday, 10 May").
- A `note` holds only words the user gave you or plain facts. Don't invent memories or feelings; leave `note` out instead.

## Reviewing the pick sheets

Swap a pick for a bench photo when the pick is:
- a sign, map, ticket, menu, receipt, or a photo of a screen or of a printed photo
- a collage or a photo with a watermark, a credit line or burned-in text
- dominated by strangers, or an accidental or tilted throwaway shot
- one of three similar compositions in a row, such as three rooftop views, which the script let through because they were shot from different spots

Swap in a bench or `more` photo when it shows:
1. people the user cares about, above everything else. When faces fill the sheets, ask who matters.
2. a wide view that says where you are, if the chapter has none
3. a detail that changes the scale, after a run of wide shots
4. something happening, not just something standing there

The ★ and the pick order are technical, not taste. A sharp but boring photo loses to a slightly soft one that tells the story. A `♥` or `edit` photo was chosen by the owner; keep it unless it is clearly broken.

## Reviewing the frames sheets

The script chose each moment's frame by sharpness, exposure, colour and the owner's ratings and edits. It can't see faces. For photos of people, pick the frame where:
- eyes are open and people look at the camera or at each other
- nobody is cut off, blocked or caught mid-blink or mid-bite
- the main person is sharp, even if the background is soft

For scenes, prefer the cleaner composition: a straight horizon, no stranger walking through, the subject not cut at the edge.

## Main photographs and scenes

- Plan each two-page spread around one activity: breakfast, a shop visit, the playground, the fountain. A day is often several scenes.
- Put 3-5 complementary photos in each scene and mark exactly one `role: "main"`. Use 2 for a deliberate quieter spread, not to pad the book. Explicit scenes support 2-10 photos.
- Choose the main photo by meaning, expression and subject focus. Sharp buildings behind a blurred person do not make a strong portrait. A product packet or shelf does not lead a family spread merely because it is colourful.
- Review candidates at a size where facial expressions and focus are visible. This is a visual decision, not a quality-score threshold.
- Technical quality is the minimum, not the ranking. A wide city view, a family portrait and a small detail can work together; three near-identical poses usually cannot.

## Safe framing

- Store one `protect` rectangle per photo in `photoSettings`. It is the area that must stay visible, expressed as fractions of the oriented image. Include all important faces and any essential body parts or objects.
- Supporting crops can be closer than the main portrait, but no person should disappear or lose a head. Do not shrink the protected region just to make a failing layout pass.
- `subject: "people"` keeps an unannotated photo whole; `fit: "contain"` explicitly keeps the entire frame. If a marked subject will not fit, the renderer also uses the full frame.
- Choose a compatible layout when protection leaves too much white. Do not sacrifice the family to save a sign, building or a decorative photo box.
- Prefer a large main image with a tight supporting mosaic. Small headings replace routine divider pages. Repeating a good layout is better than forcing narrow bands for variety.

## Cover

- **Collage cover** (`cover.photos`, 3 photos): a large, clear portrait and two complementary moments, with the title on white. This is the default with three images.
- **Single-photo cover** (`cover.photo`): a dominant photograph with a compact title; the crop uses the same protection as the interior.
- The earlier colour block and full-bleed covers remain explicit choices, not the default.
- The title page uses a different photo from the cover.

## Closing

Choose `closing.photo` as an actual closing moment: a family portrait, a walk, or a quiet view. Keep words brief and factual. The compact design ends on a photograph, not a circular table of contents.
