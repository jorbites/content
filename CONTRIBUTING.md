# Contributing to Jorbites Events 🍳📅

Welcome! This repository powers community events, weekly challenges, and badges for [Jorbites](https://jorbites.com).

Non-technical contributors can create and edit events directly via our visual web interface (**Sveltia CMS**) or through GitHub.

---

## 🎨 Event Creation Workflow (Step-by-Step)

## ⚡ Zero-Friction Event Publishing (Automated Pipeline)

You do **not** need to manually format multiple languages or cut out badges! Our automated CI pipeline handles everything:

1. **Write 1 Language (e.g. Spanish or English)**:
   - Fill in Title, Description, and Content in your preferred language.
   - Missing languages are automatically translated into Catalan, Spanish, and English using AI on publish.
2. **Upload Cover Image**:
   - Upload your AI-generated event image (PNG, JPG, or WebP).
   - The pipeline automatically resizes it to 750x750, encodes as WebP, and optimizes size to `< 100 KB`.
3. **Leave Badge Asset Blank**:
   - The pipeline isolates the subject from your cover image using AI background removal (`rembg`), resizes it to 256x256 transparent WebP, and saves `badges/<slug>.webp` automatically.

---

## 🎨 Event Creation Workflow (Manual CLI Option)

If you are developing locally or prefer using the command line:

### Step 1: AI Prompt for Event Artwork
When generating artwork with an AI generator (Midjourney, DALL-E, Gemini), use this prompt:
```text
can you generate me a vintage minimalist cartoon badge for my website call Jorbites about recipes, the logo is an avocado. The badge is for an event of "XXXXXX". avoid beige colors. avoid the avocada as a mascot (put the avocado with the "jorbites", like "🥑 Jorbites"). avoid white and green background
```

### Step 2: Auto-Process Assets & Badges Locally
```bash
# 1. Optimize cover image:
npm run process:cover /path/to/raw-image.png <event_slug>

# 2. Automatically generate badge from cover image using rembg:
npm run process:generate-badge images/<event_slug>.webp <event_slug>

# 3. Or run the full repository auto-processor:
npm run process:auto
```

### Step 3: Auto-Translate Locales
```bash
# Translates missing locales using Gemini 2.0 Flash
GEMINI_API_KEY=<your_key> npm run translate
```

---

## 🖥️ Using the Visual CMS (Sveltia CMS)

1. Open [Jorbites Events Admin](https://jorbites.github.io/events/admin/).
2. Click **Sign in with GitHub**.
3. Create a **New Event**:
   - Fill in your preferred language (Spanish or English).
   - Upload your AI-generated cover image.
   - Leave Badge blank (or upload custom badge if you prefer).
4. Click **Publish**!
5. GitHub Actions automatically optimizes images, extracts the transparent badge, translates into missing languages, and triggers a production deploy on Jorbites!

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
