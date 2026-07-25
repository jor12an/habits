# Habits — project notes

Private, local-first habit tracker web app (PWA), designed for iPhone-sized screens. Inspired by [Habit Tracker: Your Goals](https://apps.apple.com/us/app/habit-tracker-your-goals/id1471303896).

This file is for your own reference. Nothing here needs to be uploaded.

---

## Run locally

From this folder:

```bash
python -m http.server 8080 --directory public
```

Open **http://127.0.0.1:8080/**

Hard-refresh (Ctrl+Shift+R) after updates so the service worker does not serve stale files.

---

## Layout (what you see)

| Area | Behaviour |
|------|-----------|
| Top bar | `+` add · **Habits** title · sort · menu |
| Left column | Habit names + color dots + strength score — **does not move** when you swipe days |
| Right area | Day headers (weekday + date) and cells — **swipe left/right** for history (~90 days). Scrollbars are hidden; use touch/trackpad/drag |
| Cells | CSS-drawn **check** (done) or **cross** (miss). Progressive habits show **%** until full, then a check |
| Off-schedule days | Dimmed, not tappable |
| Tap name | Detail: score, streaks, 90-day heatmap, weekday rates |
| Menu | Export / import JSON, theme toggle, score explanation |

No reminders. No accounts. No server storage of habit data.

---

## Features

- Basic habits (once per scheduled day) and progressive (daily target count)
- Custom weekday schedule per habit
- Past days editable (score updates)
- Sort: custom order, strength, name, color, newest
- Drag reorder (☰) when sort = custom order
- Import / export JSON backup (import **replaces** local data)
- Dark default, optional light theme
- Offline via service worker + installable PWA

---

## Habit strength score (0–100)

Not a perfection grade — an estimate of how close the habit is to feeling automatic.

### Research basis

1. **Lally et al. (2010), European Journal of Social Psychology**  
   Self-reported automaticity rose on an **asymptotic** curve. Among good model fits, median time to ~95% of each person’s plateau was **66 days** (range **18–254**). Missing a single day did **not** reset formation.

2. **Habit as automaticity** (Gardner and others)  
   Habits strengthen through **repeated performance in stable contexts**, not through raw willpower alone.

3. **Recency** (product FAQ pattern)  
   Recent consistency should weigh more than old bulk completions.

### Algorithm (implementation)

For each habit, only **scheduled** calendar days since creation count.

1. **Recency-weighted performance**  
   Each scheduled day has completion `c ∈ [0,1]` (progressive = count/goal).  
   Weight = `exp(-λ · daysAgo)` with half-life **14 days** (`λ = ln2 / 14`).  
   `rate = Σ(c · w) / Σ(w)`.

2. **Maturity**  
   `maturity = 1 - exp(-nSched · ln(20) / 66)`  
   so ~95% of “room” opens after ~**66 scheduled opportunities** (Lally median). A lucky first week cannot look “fully formed.”

3. **Consistency**  
   Long unbroken **miss streaks** among scheduled days reduce a consistency factor (floor 0.35). Isolated misses hurt less.

4. **Score**  
   `score = round(100 · rate · maturity · consistency)` clamped 0–100.

**Stages:** New → Forming → Building → Strong → Automatic  
(Automatic requires high score and high maturity.)

In-app copy: **⋯ → How scores work**.

---

## Data model

Stored under localStorage key `habits.v1`:

```json
{
  "habits": [
    {
      "id": "h_…",
      "name": "Go jogging",
      "color": "#0a84ff",
      "type": "basic | progressive",
      "goal": 1,
      "days": [1, 2, 3, 4, 5],
      "log": { "2026-07-20": 1 },
      "created": "2026-07-01",
      "order": 0
    }
  ],
  "sort": "manual | score | name | color | created",
  "theme": "dark | light"
}
```

- `days`: weekday indices, Sunday = 0 … Saturday = 6  
- `log[date]`: integer progress that day (0 omitted; progressive can be 1…goal)  
- Export wraps this as `{ app, version, exportedAt, data }`

Migration: if `habits.v1` is missing, old `habitflow.v1` is read once.

Demo seed (first empty run): flag `habits.seeded` in localStorage.

---

## Project structure

```
Habits/
├── public/                 ← only this folder is deployed
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── sw.js
│   ├── manifest.webmanifest
│   ├── icons/
│   └── _headers
├── package.json
├── wrangler.toml           assets.directory = ./public
├── LICENSE
├── .gitignore
├── PROJECT.md
└── README.md
```

No build step. No framework. Static files only. Deploy never includes `node_modules`.

---

## Optional deploy (Cloudflare)

```bash
npm install
npx wrangler login
npm run deploy
```

`wrangler.toml` serves the project root as static assets.

---

## Known design choices

- Scrollbars on the day board are **hidden** on purpose (mobile feel); swipe still works.
- Habit names live in a **separate column** so horizontal day scroll never moves them.
- Marks are **CSS shapes**, not emoji, so they render consistently on Windows/iOS.
- Default view scrolls so **today** is on the right edge (like the reference app).

---

## Possible later work

- Categories / filters  
- Cloud sync (opt-in)  
- Notifications (limited as a web app on iOS)  
- Weekly / monthly reports charts  
- Home-screen widgets (platform-specific)

---

## Privacy

All habit data stays in the browser. Clearing site data wipes it unless you exported a backup.
