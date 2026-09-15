# Daily Sync

A shared task tracker for Mary & Evan's daily sync. Single-file app, no login -- anyone with the link can view and edit.

## Setup

1. Create a free project at supabase.com.
2. In the Supabase SQL Editor, run supabase-setup.sql.
3. In your project's API settings, copy the Project URL and anon public key.
4. Open index.html and set SUPABASE_URL and SUPABASE_ANON_KEY near the top of the script block.
5. Open index.html in a browser (or host it as a static site) and share the link with Evan.

## Features

- Task list grouped by To Do / In Progress / Done
- Unfinished tasks automatically carry over between syncs (no extra step)
- Optional assignee (Mary / Evan / Both), due date, and notes per task
- Live updates via Supabase Realtime -- useful when you're both looking at it during the call
- "Anyone / Mary / Evan" filter (local preference only, stored in your browser -- not a login)

