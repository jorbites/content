# Contributing to Jorbites Events

Thank you for contributing to Jorbites!

## 📝 Event Guidelines

Every event is written in Markdown with frontmatter at the top:

```markdown
---
title: "🥑 Avocado Day 🥑"
date: 2026-07-31T00:00:00.000Z
endDate: 2026-08-01T23:59:59.000Z
image: /images/events/avocado_day.webp
description: Celebrate the avocado season by creating amazing recipes!
---

# 🥑 Avocado Day Celebration!

Content goes here...
```

### Frontmatter Fields:
- `title` *(Required)*: Title of the event. Wrap in quotes if it contains colons or special characters.
- `description` *(Optional)*: Short summary displayed on cards.
- `date` *(Optional)*: ISO start date (e.g. `2026-07-31`).
- `endDate` *(Optional)*: ISO end date (e.g. `2026-08-01T23:59:59`).
- `image` *(Recommended)*: Path to the event image (`/images/events/your_image.webp`).
- `permanent` *(Optional)*: `true` if this event has no end date (e.g. quest badges).
- `recurrent` *(Optional)*: `true` if it happens every month.
- `dayOfMonth` *(Optional)*: `1-31` if recurrent.

### 🖼️ Images:
- Place image files inside the `images/` folder.
- Preferred format: `.webp` for optimized web delivery.
- Reference it in markdown as `/images/events/filename.webp`.
