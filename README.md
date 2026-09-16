# Sync Up

A shared task tracker for Mary & Sarah's daily sync. Single-file app, no login -- anyone with the link can view and edit.

## Setup

1. Create a free project at supabase.com.
2. In the Supabase SQL Editor, run supabase-setup.sql.
3. In your project's API settings, copy the Project URL and anon public key.
4. Open index.html and set SUPABASE_URL and SUPABASE_ANON_KEY near the top of the script block.
5. Open index.html in a browser (or host it as a static site) and share the link with Sarah.

## Features

- Daily Review checklist (Calendar, Tasks, Inbox, etc.) shared between Mary and Sarah, resets each day
- Tasks grouped by category (Hot Topics, Follow Up, Non-Urgent, etc.) instead of a status board; move a task to a different category anytime with the dropdown on its card
- Task title and notes are editable inline, right on the card
- Unfinished tasks automatically carry over between syncs (no extra step)
- Optional due date per task
- Live updates via Supabase Realtime -- useful when you're both looking at it during the call
- "Mary / Sarah" toggle (local preference only, stored in your browser -- not a login): selecting a name both filters the view and assigns any new task you add to that person; tap the active name again to go back to viewing everyone
