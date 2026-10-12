# Jorbites Events, Badges & Challenges 🍳📅

This repository holds the community-contributed events, weekly challenges, cover images, and badge assets for [Jorbites](https://jorbites.com).

## 👥 How to Contribute (Non-Technical Guide)

You do **not** need to install Git or know how to code to contribute events!

### Option 1: Web CMS (Recommended)
1. Open [Jorbites Events Admin](https://jorbites.github.io/events/admin/).
2. Click **Sign in with GitHub**.
3. Choose or create an event — **Català**, **Español**, and **English** are displayed side-by-side!
4. Fill in the event title, description, and dates. Upload your cover image and badge.
5. Click **Publish**. A pull request or commit will be created automatically!

### Option 2: Editing Directly on GitHub
1. Browse to `content/ca/`, `content/es/`, or `content/en/`.
2. Click on any event file, then click the **Pencil icon** (✏️) to edit.
3. Make your changes and commit.

For detailed guidelines on generating event artwork and badges, see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 📁 Repository Structure

```
.
├── admin/                     # Sveltia CMS visual admin dashboard
│   ├── config.yml
│   └── index.html
├── content/
│   ├── ca/                    # Events in Catalan
│   ├── en/                    # Events in English
│   ├── es/                    # Events in Spanish
│   └── weekly-challenges.json # Weekly recipe challenge presets
├── images/                    # Cover images (~750x750 WebP < 100KB)
├── badges/                    # Transparent badge assets (256x256 WebP)
├── scripts/
│   ├── process-asset.ts       # Sharp asset processing CLI
│   └── validate.ts            # Schema, image, and badge validator
└── .github/
    └── workflows/
        ├── validate.yml       # Automated PR checks
        └── deploy.yml         # Vercel deployment trigger on merge
```

---

## 🛠️ Developer Commands

```bash
npm install

# Validate all content, images (<100KB), and badges (256x256 transparent)
npm run validate

# Process raw cover image (resizes to 750x750, converts to WebP <100KB)
npm run process:cover /path/to/raw-image.png <event_slug>

# Process badge asset (resizes to 256x256 WebP with alpha)
npm run process:badge /path/to/transparent-badge.png <event_slug>

# Format markdown and JSON files
npm run format
```
