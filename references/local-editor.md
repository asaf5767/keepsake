# Local editor

The local editor is an optional Keepsake step. It is not a hosted service and
does not replace culling, picking, scene design or final proofing.

## Start it

After `album.json` has explicit compact scenes:

```powershell
node scripts/edit.mjs "C:\Photos\Trip-keepsake\album.json"
```

The command opens a tokenized `127.0.0.1` URL and keeps running until stopped.
Use `--no-open` when another tool will open the printed URL, `--port 0` for any
free port, or `--project "C:\path\book.project.json"` for a non-default project
file.

The first launch builds the album if current editable layout evidence is not
available. It then creates `album.project.json`.

## What is saved

`album.project.json` is a versioned editable document. It holds:

- the order of scene spreads;
- stable spread, photo-frame, text and graphic IDs;
- the photograph in each frame, plus optional white frame border (`mat`);
- left and right page watercolor washes (`none`, `sky`, `rose`, `sand`, `sage`, `lavender`);
- vector graphics and badges (`flourish-scroll`, `flourish-heart`, `boho-arrow`, `botanical-flower`, `lavender-sprig`, `badge-love-circle`, `badge-love-frame`, `badge-heart`, `compass-star`);
- millimetre boxes across the complete two-page spread;
- safe, contained or manual crop controls;
- wording, text size, style (`sans` or `script`), colour and alignment;
- the selected layout family, paper, type, decor mode and review decisions.

Every save checks the previous revision and writes through a temporary file.
An old browser tab cannot silently overwrite a newer save.

The project also stores a fingerprint of the album's structural input. Changing
scene IDs, scene photographs, framing instructions or print geometry makes the
project intentionally fail to load. This is safer than applying old coordinates
to a different book. Wording, paper and type are edited in the project itself.

## What the UI can change

The production UI uses the selected Storyboard workflow:

- see and reorder the complete story;
- open one scene spread;
- preview and apply portrait-lead, reverse-lead, framed-haven (framed portrait + flourishes),
  overlap-story (layered inset + motif), center-note-grid (mosaic around a central note + scroll flourish),
  wide-story, portrait-row/facing-pair and story-mosaic layouts when they are safe for those photos;
- replace a photograph from the locally kept photo library, or toggle its white photo border;
- choose left and right page watercolor washes, add/swap/move/resize vector graphics and seam stickers, or drop in optional script/sans callouts;
- move and resize photo, graphic or text objects across both pages;
- use subject-aware, whole-photo or manual framing;
- edit titles and notes, or add another text object;
- change white, cream or dark paper and Montserrat/Heebo type;
- mark a spread reviewed;
- undo, save, close and reopen;
- export the reading and print PDFs.

The cover, opening and closing keep their existing production templates in this
version. Book title, subtitle, paper and type still update them at export.

## Export

**Export PDFs** first saves the current project, then runs the same renderer as
the non-UI workflow. It is not a screenshot or browser canvas export.

The equivalent command is:

```powershell
node scripts/build.mjs "C:\Photos\Trip-keepsake\album.json" `
  --project "C:\Photos\Trip-keepsake\album.project.json"
```

The generated `book/layout.json` includes:

```json
{
  "editorProject": {
    "id": "...",
    "revision": 4,
    "file": "album.project.json"
  }
}
```

It also records each saved frame/text ID and box. This is the contract used to
prove that a PDF came from the current saved project.

## Local safety

- The server listens only on `127.0.0.1`.
- Each launch uses a new random token.
- Project/photo/PDF routes require that token.
- Photos are served only by known cull codes; filesystem paths are never sent
  to the browser.
- Project requests are size-limited and schema-validated.
- Original photographs are never changed.

The editor process must stay open while the browser is in use. Press `Ctrl+C`
in its terminal to stop it.
