# Photo-book quality

Keepsake is an experience of the photographs, not a dashboard and not a collection
of AI-written captions. These book-specific rules are informed by Impeccable's
hierarchy, grouping, restraint and bounded-review principles
([Paul Bakaus, Impeccable](https://impeccable.style), Apache-2.0). They are written
for Keepsake; running or installing Impeccable is not required.

## Let the photographs lead

- Choose the important moment first, then its layout. A face with good expression
  matters more than a high sharpness score for the wall behind it.
- One photograph should lead each spread. Supports add people, action or detail,
  rather than repeating the same pose at different sizes.
- Shared background is not proof of a duplicate. Compare who is present, their
  expressions and what is happening. Technical similarity suggests comparisons;
  it cannot finish the edit.
- Inspect all final main photographs large. A contact sheet is for navigation,
  not a substitute for checking eyes and focus.

## Compose a book, not a template gallery

- Keep supporting photographs together with aligned edges and tight, consistent
  gaps. Avoid a chain of isolated little images surrounded by accidental holes.
- Alternate dense mosaics with quieter hero spreads when the content warrants it.
  Do not force a different template for every spread.
- Wide photographs need wide frames; portraits need taller ones. If a safe crop
  cannot fill a full page, frame it deliberately. Never stretch or cut off people.
- A sparse landscape page is not automatically wrong. Judge its relationship to
  the facing page. Do not add a random arrow to justify a huge empty region.
- Use subtle washes and thin white borders as in the user's printed-album
  references. Small motifs belong in real open space, never over faces.
- The automatic planner can choose the crafted editor layouts too. A
  `center-note-grid` needs an actual requested heading or note; do not invent one
  just to fill its tile. Explicit `scene.layout` must still pass crop safety.

## Words must earn their space

- Default to photographs without spread headings (`showHeadings: false`) or
  decorative phrases (`callouts: false`).
- The user's album title belongs on the cover/opening. Their own notes can be
  beautiful; generic phrases such as "special moments" add nothing.
- Do not guess family relationships, identities, feelings or events. Ask when
  that fact changes selection; otherwise leave the claim out.
- Keep user-approved wording short and legible. No tiny date/kicker above every
  page merely because the template has a slot.
- In Hebrew, preserve RTL reading order and Hebrew type. Manually adding an
  English callout is the user's choice, not an automatic translation fallback.

## Proof the artifact people actually receive

- Fixed print pages keep their physical size; the web viewer scales the whole
  page, not its contents independently.
- `album.pdf` must have trim-sized MediaBox and CropBox. Print PDFs retain bleed.
  Check the actual drawn image sizes as well as these declared boxes.
- Inspect the PDF itself, at least the cover, a hero page and a decorated spread.
  Good HTML screenshots cannot prove that PDF export has not shrunk the content.
- Reserve different photos for cover, opening, interior and closing unless a
  deliberate repeat is approved. Do not add weak filler to meet a printer target.
- Keep the original build. Review once, fix the identified defects in one batch,
  then confirm. A remaining issue is reported, not silently called a pass.
- Delivery includes the PDF and a reachable local editor link. The editor must
  remain alive while the user is editing; its printed URL alone is not a handoff.
