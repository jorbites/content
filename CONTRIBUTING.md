# Contributing to Jorbites Content 🥑📅

Welcome! This repository powers community events, blog articles, weekly challenges, and badges for [Jorbites](https://jorbites.com).

Non-technical contributors can create and edit content directly via our visual web interface (**Sveltia CMS**) or through GitHub.

---

## ⚡ Zero-Friction Publishing (Automated Pipeline)

You do **not** need to manually format multiple languages, compress images, or cut out badges! Our automated CI pipeline handles everything:

### 📅 For Events:
1. **Write 1 Language (Spanish or English)**:
   - Fill in Title, Description, and Content in your preferred language.
   - Missing languages are automatically translated into Catalan, Spanish, and English using AI on publish.
2. **Upload Cover Image**:
   - Upload any event image (PNG, JPG, or WebP).
   - The pipeline automatically resizes it to 750x750, encodes as WebP, and optimizes size to `< 100 KB`.
3. **Leave Badge Asset Blank**:
   - The pipeline isolates the subject from your cover image using AI background removal (`rembg`), resizes it to 256x256 transparent WebP, and saves `badges/<slug>.webp` automatically.

### 📝 For Blog Posts:
1. **Write 1 Language (Spanish or English)**:
   - Provide Title, Description, and Markdown body.
   - Missing languages are automatically translated on publish.
2. **Embed Images**:
   - Upload any image (`.png`, `.jpg`, `.webp`) in the editor.
   - The pipeline automatically converts it to WebP, optimizes size to `< 100 KB`, and updates markdown image references across all locales automatically.

---

## 🖥️ Using the Visual CMS (Sveltia CMS)

1. Open [Jorbites Content Admin](https://jorbites.github.io/content/admin/).
2. Click **Sign in with GitHub**.
3. Select either the **Events** or **Blog Posts** collection.
4. Fill in your content in your primary language and upload your image(s).
5. Click **Publish**!
6. GitHub Actions automatically runs the isolated optimization and translation pipelines, creates the auto-commit, and triggers a production deploy on Jorbites!

---

## 🎨 Event Artwork Prompt Guide

When generating artwork for events with an AI generator (Midjourney, DALL-E, Gemini), use this prompt template:
```text
can you generate me a vintage minimalist cartoon badge for my website call Jorbites about recipes, the logo is an avocado. The badge is for an event of "XXXXXX". avoid beige colors. avoid the avocada as a mascot (put the avocado with the "jorbites", like "🥑 Jorbites"). avoid white and green background
```

---

## 🛠️ Local Testing & Validation

Before submitting a PR, verify all content passes schema and image constraints:

```bash
npm install

# Run full validation
npm run validate

# Run individual validations
npm run validate:events
npm run validate:blogs
```

CI will automatically check:
- **Events**: Valid YAML frontmatter across all languages, dates formatted correctly without UTC shifts, cover images `< 100 KB` WebP, transparent badges `256x256` WebP.
- **Blogs**: Required fields (`title`, `description`, `date`, `user_id` as 24-character MongoDB ObjectId), and referenced body images `< 100 KB` WebP.
