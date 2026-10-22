# Keepsake: a guide for people who don't write code

**You have thousands of trip photos and no time to choose? Keepsake does it for you.**

Keepsake is a *skill*: a new ability you add to an AI assistant like Claude or ChatGPT. It looks at every photo in a folder. It throws out blurry photos, copies and screenshots, picks the best moments and designs an album. You get a PDF that is ready to print, and you can still change anything yourself.

You don't need to know code. You copy, paste and click "Allow".

<p align="center"><a href="start-here.he.md">גרסה בעברית</a></p>

---

## What you need

- **A computer** (Windows or Mac). It does not work on a phone.
- **One of these apps, installed on the computer:**
  - **Claude** for desktop, in the **Code** tab. You need a paid plan (Pro or higher).
  - **ChatGPT** for desktop, with **Codex**. Check that your plan includes Codex.
- **A folder with your photos** on the computer.

> ⚠️ **It does not work in the website chat** (claude.ai or chatgpt.com). Only in the app installed on your computer.
> Why: Keepsake works on the photos on your computer. The photos themselves are not uploaded anywhere.

---

## Step 1: Install the app (once)

**Claude:** download it from [claude.com/download](https://claude.com/download), install it, sign in and click the **Code** tab at the top.

**ChatGPT:** download it from [chatgpt.com/download](https://chatgpt.com/download), install it and sign in. The assistant that works with files on your computer is called **Codex**.

---

## Step 2: Put the photos in one folder

Put all the photos from the trip (or the year) in one folder on your computer. For example: `Pictures\New York 2025`.

- **Photos on your phone?** Move them to the computer with a cable, or download them from Google Photos or iCloud.
- **Photos in Google Drive?** If you have the Google Drive app for desktop, the folder is already on your computer (usually on drive `G:`). Right-click it and choose **Available offline**, so the photos are really downloaded. You can also download the folder from the Drive website as a ZIP file and unzip it.

---

## Step 3: Start a chat and choose a folder

The assistant needs access to the folder so it can work with the photos.

**Choose the folder that contains your trip folder**, not the trip folder itself. For example: choose `Pictures`, not `Pictures\New York 2025`. This gives Keepsake room to make the album folder next to your photos.

- **Claude:** in the **Code** tab, under the message box, choose to run on your computer (**Local**). Click the folder button and choose the folder.
- **ChatGPT:** click **Add new project** (or press `Ctrl+O`) and choose the folder.

---

## Step 4: Install Keepsake (once)

Copy this message **exactly as it is**, paste it into the chat and send it:

```text
Please install the Keepsake skill from: https://github.com/asaf5767/keepsake

1. Put it in your personal skills folder, in a folder named keepsake:
   - If you are Claude:  ~/.claude/skills/keepsake
   - If you are Codex (ChatGPT):  ~/.agents/skills/keepsake
   Use git clone, or download the ZIP file:
   https://github.com/asaf5767/keepsake/archive/refs/heads/main.zip
2. Make sure Node.js 22.12 or newer is installed. If not, install the LTS version.
3. Run npm install inside the skill's scripts folder.
4. Make sure Google Chrome or Microsoft Edge is installed.

I am not technical. Explain each step in one simple sentence, and tell me at the end if everything is ready.
```

**What happens now:**
- The assistant asks for **permission** a few times: to download files and to install software. This is normal. Click **Allow** or **Approve**.
- If Node.js is not installed, your computer may ask for your password or for permission to install it. This is normal too.
- It takes a few minutes.

When the assistant says everything is ready, **start a new chat** (in the same folder). A new chat can "see" the new skill.

---

## Step 5: Make an album

In the new chat, write this with your own folder name:

```text
Make me a photo album from the folder "New York 2025"
```

- The assistant asks a few questions: a title for the album, the language, and who the important people in the photos are.
- **The first time**, it downloads a small AI model (about 90 MB) that recognises what is in each photo. The model runs on your computer.
- Hundreds of photos take a while. Go and make a coffee ☕

**Where is the album?** A new folder appears next to your photos, with `-keepsake` at the end of its name. Inside it is a folder named `book`. The file **`album.pdf`** is your album. You can also just ask: "Open the album for me".

---

## Step 6: Change it yourself (optional)

Don't like a photo? Want a different order? Write:

```text
Open the editor
```

A page opens in your browser with all the pages of the album:
- Drag the scenes to change their order.
- Click a photo, then **Replace photo**, to choose another photo from the trip.
- Choose another layout for a page, or change the text.
- Click **Save** to save, and **Export PDFs** to get a new PDF.

Everything is saved. You can close it and come back later.

---

## Step 7: Print it

The `book` folder has two files for printing: **`interior.pdf`** (the pages) and **`cover.pdf`** (the cover). The size is 30 × 30 cm.

Upload them to a photo-book printing service that accepts a ready PDF. Not sure what to do? Write to the assistant:

```text
Explain simply how I print this album
```

---

## Privacy

- Your photos **stay on your computer.** Keepsake does not upload photos or locations anywhere.
- To choose photos, the assistant looks at **sheets of small photos**. These sheets go to Claude or ChatGPT, like any picture you send in a chat.

---

## Something doesn't work?

| What happened | What to do |
|---|---|
| The assistant doesn't know Keepsake | Start a **new chat**. If it still doesn't work, write: "Check if Keepsake is installed" |
| An error message appears | Copy it into the chat and write: **"Fix this"** |
| The assistant says it can't reach the photos | Go back to step 3 and choose the folder that contains your trip folder |
| Photos in Drive are not found | Check that the folder is set to **Available offline** (step 2) |
| It takes a long time | This is normal the first time and with many photos. Wait |
| You want the newest Keepsake | Write: "Update Keepsake from https://github.com/asaf5767/keepsake" |

---

Made with love by Assaf Akiva. Tell me how your album came out 📸
