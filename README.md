# Sync Up

A shared task tracker for Mary & Sarah's daily sync. Single-file app, no login -- anyone with the link can view and edit.

## Setup

1. Create a free project at supabase.com.
2. In the Supabase SQL Editor, run supabase-setup.sql.
3. In your project's API settings, copy the Project URL and anon public key.
4. Open index.html and set SUPABASE_URL and SUPABASE_ANON_KEY near the top of the script block.
5. Open index.html in a browser (or host it as a static site) and share the link with Sarah.

## Features

- "Mary / Sarah" toggle (local preference only, stored in your browser -- not a login): selecting a name both filters the view and assigns any new task you add to that person. Until a name is chosen, the board is hidden behind a prompt to pick one.
- **Mary's view** is the full board: tasks grouped by category, shown as a 2-column board on wider screens (1 column on mobile); drag a task by its grip handle to move it to a different category. Categories aren't fixed -- type a new tag when adding a task and it becomes its own category; existing tags autocomplete via suggestions.
  - Pin a task with the 📌 button to keep it at the top of its category
  - Mark a task "↻ Daily" when adding it to have it automatically reset to To Do each day, even after it's checked off
  - Each task shows a small "Updated Xh ago" / "Completed by Mary" line
  - Completed tasks collect in a "Done" section; anything older than 3 days collapses behind a "Show N older completed" link
- **Sarah's view** is a simpler To Do / In Progress / Done list (no categories, pinning, or recurring) -- her day-to-day is more straightforward, so it stays out of the way
- Search bar filters tasks by title or notes as you type
- Task title and notes are editable inline, right on the card
- Attach photos to a task with the "+ Add a photo" control on its card (auto-resized before upload); tap a thumbnail to view full-size
- Unfinished tasks automatically carry over between syncs (no extra step)
- Optional due date per task, with a badge that turns red once it's overdue
- A banner flags tasks updated since your last visit to the app
- Print / export button for a clean printable copy of the board
- Daily Review checklist (Calendar, Tasks, Inbox, etc.) shared between Mary and Sarah, resets each day
- Live updates via Supabase Realtime -- useful when you're both looking at it during the call

## Adding tasks from Claude

Sarah can add tasks straight from a Claude chat -- e.g. "add a task for Mary to follow up with Adria about the template" -- without opening the app. This works via a small custom Claude connector (a remote MCP server at `/api/mcp`, deployed alongside the app on Vercel) that can add and list tasks on the same shared board.

To set it up in Claude (one-time, per person who wants to use it):
1. In Claude's settings, find **Connectors** (or **Custom Connectors**) and add a new one.
2. Set the URL to `https://daily-sync-woad.vercel.app/api/mcp`.
3. No login/API key needed -- it uses the same open, no-auth model as the rest of the app.

Once added, just ask Claude in chat to add, or list, a task and it'll show up live on the board.
