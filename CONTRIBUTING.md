# Contributing to Jorbites Events 🍳📅

Welcome! This repository powers community events, weekly challenges, and badges for [Jorbites](https://jorbites.com).

Non-technical contributors can create and edit events directly via our visual web interface (**Sveltia CMS**) or through GitHub.

---

## 🎨 Event Creation Workflow (Step-by-Step)

### Step 1: Generate or Write the Markdown Content
An event consists of 3 localized files with matching filenames (`<event_slug>.md`):
- `content/ca/<event_slug>.md` (Catalan)
- `content/es/<event_slug>.md` (Spanish)
- `content/en/<event_slug>.md` (English)

#### Frontmatter Specifications:
```markdown
---
title: "🥑 Avocado Day 🥑"
date: 2026-07-31
endDate: 2026-08-01T23:59:59
image: /images/events/avocado_day.webp
badge: /badges/avocado_day.webp
description: Celebrate the avocado season by creating amazing recipes!
permanent: false
recurrent: false
---

# 🥑 Avocado Day Celebration!

Content goes here...
```

> [!IMPORTANT]
> - **Dates**: Use `YYYY-MM-DD` for `date` and `YYYY-MM-DDTHH:mm:ss` for `endDate`. Do **not** append a `Z` or timezone offset, to avoid UTC date shifting in cron notifications.
> - **Titles**: Always wrap titles containing colons or special characters in quotes (`"Title: Subtitle"`).

---

### Step 2: Generate the Badge / Event Image (AI Prompt)

When generating the event badge artwork with an AI image generator (e.g., Midjourney, DALL-E, Gemini), use this standard prompt template:

```text
can you generate me a vintage minimalist cartoon badge for my website call Jorbites about recipes, the logo is an avocado. The badge is for an event of "XXXXXX". avoid beige colors. avoid the avocada as a mascot (put the avocado with the "jorbites", like "🥑 Jorbites"). avoid white and green background
```
*(Replace `XXXXXX` with your event theme, e.g. "Mexican Tacos", "Pasta Perfection", "Autumn Flavors").*

---

### Step 3: Create the Cover Image (`images/`)
The main event image is displayed on event cards and headers:
- **Format**: `.webp`
- **Resolution**: ~`750x750px`
- **File Size**: **< 100 KB** (required)
- **Destination**: `images/<event_slug>.webp` (referenced in markdown as `/images/events/<event_slug>.webp`)

#### ⚡ Automated Script:
You can automatically resize and optimize the cover image using our CLI tool:
```bash
npm run process:cover /path/to/raw-image.png <event_slug>
```
This automatically resizes to 750x750, converts to WebP, and adjusts quality until the file is under 100 KB.

---

### Step 4: Create the Badge Asset (`badges/`)
The badge asset is awarded to users upon completing the event:
- **Format**: `.webp`
- **Resolution**: Exactly `256x256px`
- **Background**: **Transparent** (alpha channel)
- **Destination**: `badges/<event_slug>.webp` (referenced in markdown as `/badges/<event_slug>.webp`)

#### Procedure:
1. Remove the background from the badge (using tools like remove.bg, Photoshop, or your preferred tool).
2. Process with our CLI tool:
```bash
npm run process:badge /path/to/transparent-badge.png <event_slug>
```
This automatically resizes to 256x256 WebP while preserving full transparency.

---

## 🖥️ Using the Visual CMS (Sveltia CMS)

1. Open [Jorbites Events Admin](https://jorbites.github.io/events/admin/).
2. Click **Sign in with GitHub**.
3. Sveltia CMS lets you edit Catalan, Spanish, and English side-by-side!
4. Upload your cover image (`images/`) and badge asset (`badges/`).
5. Save your draft. When ready, publish the changes!

---

## 🛠️ Local Testing & Validation

Before submitting a PR, verify all content passes schema and image constraints:

```bash
npm install
npm run validate
```

CI will automatically check:
- Valid YAML frontmatter across all languages.
- Dates formatted correctly without UTC shifts.
- Cover images present, in `.webp` format, and `< 100 KB`.
- Badge assets present, in `.webp` format, `256x256`, with transparency.
