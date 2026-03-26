# Dugout Dost

The IPL prediction league app for the YouTube community. Predict match winners, make season-long picks, and compete on a real-time leaderboard.

## Features

- **Daily Match Predictions** — Pick winners for every IPL match. Editable until 15 minutes before the match starts, then locked automatically.
- **Season-Long Predictions** — Predict the Tournament Winner, Runner-up, Top 4, Orange/Purple Cap, and Last Place team. Locked once the season begins.
- **Live IPL Schedule** — Full season schedule pulled from the official IPL feed with automatic polling (every 5 min on match days, daily otherwise).
- **Real-Time Leaderboard** — Live rankings powered by Firestore snapshots, updated instantly as matches are resolved.
- **Admin Panel** — Manage matches (create, resolve, delete), import matches from the IPL feed, manage users (edit, promote/demote roles, remove).
- **Authentication** — Google sign-in and Email/Password via Firebase Auth. Role-based access (Admin / Regular User).

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Framer Motion
- **Backend:** Firebase (Auth, Firestore)
- **Build:** Vite 6
- **Routing:** React Router 7

## Getting Started

**Prerequisites:** Node.js 20+

1. Clone the repo:

```bash
git clone git@github.com:AlabhyaVaibhav/dugout-dost.git
cd dugout-dost
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env.local` from the example:

```bash
cp .env.example .env.local
```

4. Set your `GEMINI_API_KEY` in `.env.local`.

5. Start the dev server:

```bash
npm run dev
```

The app runs at **http://localhost:3000**.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | TypeScript type check |
| `npm run clean` | Remove `dist/` folder |

## Firebase Setup

The app uses a Firebase project with:
- **Authentication** — Enable Google and Email/Password providers in the Firebase Console.
- **Firestore** — Uses a named database. Rules are in `firestore.rules`.
- **Config** — Firebase web app config is in `firebase-applet-config.json`.

To deploy Firestore rules:

```bash
firebase login
firebase deploy --only firestore:rules --project gen-lang-client-0808011923
```

## Project Structure

```
src/
├── App.tsx          # All components (Auth, Dashboard, Schedule, Predictions, Admin, etc.)
├── firebase.ts      # Firebase init, auth, Firestore exports
├── iplFeed.ts       # IPL schedule feed fetcher + polling hook
├── types.ts         # TypeScript types (UserProfile, Match, Prediction, etc.)
├── main.tsx         # React entry point
├── index.css        # Tailwind + fonts
└── lib/
    └── utils.ts     # Tailwind merge utility
```

## Scoring Rules

**Daily Predictions:**
- Correct Winner: 5 pts
- Correct Winner + Margin: +3 pts
- Player of the Match: +2 pts

**Season-Long Predictions:**
- Winner: 50 pts | Runner-up: 30 pts
- Top 4 (any order): 10 pts each | Correct order bonus: +20 pts
- Orange Cap / Purple Cap: 25 pts each
- Last Place: 20 pts
- Finalist Pair Bonus: +20 pts | Winner + Runner-up Combo: +30 pts
