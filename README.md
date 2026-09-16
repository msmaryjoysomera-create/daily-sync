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
- Tasks grouped by category, shown as a 2-column board on wider screens (1 column on mobile); drag a task by its grip handle to move it to a different category
- Categories aren't fixed -- type a new tag when adding a task and it becomes its own category; existing tags autocomplete via suggestions
- Completed tasks collect in their own "Done" section, out of the way of active categories
- Search bar filters tasks by title or notes across all categories as you type
- Task title and notes are editable inline, right on the card
- Attach photos to a task with the + button on its card (auto-resized before upload); tap a thumbnail to view full-size
- Unfinished tasks automatically carry over between syncs (no extra step)
- Optional due date per task, with a badge that turns red once it's overdue
- Live updates via Supabase Realtime -- useful when you're both looking at it during the call
- "Mary / Sarah" toggle (local preference only, stored in your browser -- not a login): selecting a name both filters the view and assigns any new task you add to that person; tap the active name again to go back to viewing everyone
