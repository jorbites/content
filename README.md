# Jorbites Events & Challenges 🍳📅

This repository holds the community-contributed events, weekly challenges, and image assets for [Jorbites](https://jorbites.com).

## 👥 How to Contribute (Non-Technical Guide)

You do **not** need to install Git or know how to code to contribute events!

### Option 1: Web Admin (Recommended)
1. Visit the [Jorbites Events Admin](https://jorbites.github.io/events/admin/).
2. Log in with your GitHub account.
3. Choose the language collection you wish to edit (**Català**, **Español**, or **English**).
4. Fill in the title, description, dates, upload an image, and write your event text.
5. Click **Save** and **Publish**. Your change will be submitted automatically as a reviewable update!

### Option 2: Editing Directly on GitHub
1. Browse to `content/ca/`, `content/es/`, or `content/en/`.
2. Click on any event file, then click the **Pencil icon** (✏️) to edit.
3. Make your changes and click **Commit changes...** at the top right.

---

## 📁 Repository Structure

```
.
├── admin/                     # Decap CMS web admin dashboard
│   ├── config.yml
│   └── index.html
├── content/
│   ├── ca/                    # Events in Catalan
│   ├── en/                    # Events in English
│   ├── es/                    # Events in Spanish
│   └── weekly-challenges.json # Weekly recipe challenge presets
├── images/                    # Event cover images & badge assets
├── scripts/
│   └── validate.ts            # Automated schema validation script
└── .github/
    └── workflows/validate.yml # CI pipeline validating PRs
```

## 🛠️ Developer Setup & Validation

If you are developing locally:
```bash
npm install
npm run validate   # Checks all markdown frontmatters, dates, and image references
```
