# Jorbites Content: Events, Blogs, Badges & Challenges 🥑📅

This repository holds the community-contributed events, blog posts, weekly challenges, images, and badge assets for [Jorbites](https://jorbites.com).

## 👥 How to Contribute (Non-Technical Guide)

You do **not** need to install Git or know how to code to contribute events or blog posts!

### Option 1: Web CMS (Recommended)
1. Open [Jorbites Content Admin](https://jorbites.github.io/content/admin/).
2. Click **Sign in with GitHub**.
3. Choose a collection:
   - **Events**: Català, Español, and English side-by-side. Upload your cover image; the badge will be auto-extracted!
   - **Blog Posts**: Català, Español, and English side-by-side. Embed images; they will be auto-optimized to WebP `<100KB`!
4. Click **Publish**. A pull request or commit will be created automatically, and CI will handle optimization and translation!

### Option 2: Editing Directly on GitHub
1. Browse to `content/events/{ca,es,en}/` or `content/blogs/{ca,es,en}/`.
2. Click on any markdown file, then click the **Pencil icon** (✏️) to edit.
3. Make your changes and commit.

For detailed guidelines on artwork, image optimization, and automation pipelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 📁 Repository Structure

```
.
├── admin/                     # Sveltia CMS visual admin dashboard
│   ├── config.yml
│   └── index.html
├── content/
│   ├── events/
│   │   ├── ca/                # Events in Catalan
│   │   ├── en/                # Events in English
│   │   ├── es/                # Events in Spanish
│   │   └── weekly-challenges.json # Weekly recipe challenge presets
│   └── blogs/
│       ├── ca/                # Blog posts in Catalan
│       ├── en/                # Blog posts in English
│       └── es/                # Blog posts in Spanish
├── images/
│   ├── events/                # Event cover images (~750x750 WebP < 100KB)
│   └── blogs/                 # Blog body images (WebP < 100KB)
├── badges/                    # Transparent badge assets (256x256 WebP)
├── scripts/
│   ├── validate.ts            # Master validator
│   ├── validate-events.ts     # Dedicated events validator
│   ├── validate-blogs.ts      # Dedicated blogs validator
│   ├── process-event.ts       # Event cover optimization & badge generation
│   ├── process-blog.ts        # Blog image optimizer & markdown link updater
│   ├── auto-process.ts        # Git diff inspector & pipeline dispatcher
│   ├── translate.ts           # Master AI translation orchestrator
│   ├── translate-events.ts    # Events translation via Gemini Flash
│   └── translate-blogs.ts     # Blogs translation via Gemini Flash
└── .github/
    └── workflows/
        ├── auto-process.yml   # Auto-optimize, badge extraction & translation
        ├── validate.yml       # PR validation checks
        └── deploy.yml         # Vercel deployment trigger on merge
```

---

## 🛠️ Developer Commands

```bash
npm install

# Run full validation
npm run validate

# Run isolated validations
npm run validate:events
npm run validate:blogs

# Process assets locally
npm run process:auto                           # Inspect git diff & process changed assets
npm run process:cover /path/to/img.png <slug>  # Optimize cover (750x750 WebP < 100KB)
npm run process:generate-badge <cover> <slug>  # Extract badge using AI rembg
npm run process:blog /path/to/img.png          # Optimize blog image to WebP < 100KB

# Auto-translate missing locales using Gemini Flash
GEMINI_API_KEY=<key> npm run translate
GEMINI_API_KEY=<key> npm run translate:events
GEMINI_API_KEY=<key> npm run translate:blogs

# Format markdown, json, yaml
npm run format
```
