-- Daily Sync -- Supabase table setup
-- Originally open to the anon key ("anon full access" policies below). Since
-- 2026-10-02 the board is locked to one shared team login -- see "Lock" at the
-- end of this file, which replaces those policies.

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  assignee     text,
  tag          text,
  status       text not null default 'todo',
  notes        text,
  due_date     date,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table tasks enable row level security;

create policy "anon full access" on tasks for all using (true) with check (true);

alter publication supabase_realtime add table tasks;

-- Daily Review checklist (Calendar, Tasks, Inbox, etc.) -- checked state
-- per calendar day, shared between Mary and Sarah, resets each new day.
create table daily_review (
  day date not null,
  item text not null,
  checked boolean not null default false,
  primary key (day, item)
);

alter table daily_review enable row level security;

create policy "anon full access" on daily_review for all using (true) with check (true);

alter publication supabase_realtime add table daily_review;

-- Photos attached to tasks. Files live in a public storage bucket
-- (resized/compressed client-side before upload); this table just
-- tracks which photos belong to which task.
insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', true)
on conflict (id) do nothing;

create policy "anon full access to task-photos"
on storage.objects for all
using (bucket_id = 'task-photos')
with check (bucket_id = 'task-photos');

create table task_photos (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  url        text not null,
  path       text not null,
  created_at timestamptz not null default now()
);

alter table task_photos enable row level security;

create policy "anon full access" on task_photos for all using (true) with check (true);

alter publication supabase_realtime add table task_photos;

-- Task history (who/when), recurring tasks, and pinning -- Mary's board only;
-- Sarah's simpler To Do / In Progress / Done view doesn't surface these.
alter table tasks add column if not exists updated_at timestamptz not null default now();
alter table tasks add column if not exists completed_by text;
alter table tasks add column if not exists recurring boolean not null default false;
alter table tasks add column if not exists pinned boolean not null default false;

-- Where a task came from -- null/omitted means added in the app itself;
-- 'claude' means added via the Claude connector (api/mcp.js).
alter table tasks add column if not exists source text;

-- Sticky Wall: freeform sticky notes, per profile (Mary's / Sarah's), not
-- tied to any task.
-- (The Sticky Wall and single Notepad were replaced by Notes.) Each note is
-- a row here marked color = 'note', per profile; a note with no title shows
-- its creation date as its name.
-- Mary's tags (the Lists in her sidebar) are rows here too, marked with
-- color = 'tag': title = tag name, body = sort order.
create table sticky_notes (
  id         uuid primary key default gen_random_uuid(),
  assignee   text,
  title      text,
  body       text,
  color      text not null default '#FCE8A8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sticky_notes enable row level security;

create policy "anon full access" on sticky_notes for all using (true) with check (true);

alter publication supabase_realtime add table sticky_notes;

-- Evan's profile (Outlook To Do style): "My Day" is the date a task was added
-- to My Day (shows only on that day); steps are a checklist inside a task.
-- "Important" reuses pinned; Evan's lists are tag rows with assignee 'evan'.
alter table tasks add column if not exists my_day date;
alter table tasks add column if not exists steps jsonb not null default '[]'::jsonb;

-- Drag-to-reorder within a list: lower position = higher in the list. Tasks
-- never dragged have no position and keep their default order.
alter table tasks add column if not exists position double precision;

-- Lock: one shared team login (Supabase Auth user mary@ccabinet.com, whose
-- password is the team passcode). Only that signed-in user can read or write;
-- the public anon key alone sees nothing. The Claude connector (api/mcp.js)
-- and the Word backup (scripts/backup.mjs) use the service-role key instead.
drop policy if exists "anon full access" on tasks;
drop policy if exists "anon full access" on daily_review;
drop policy if exists "anon full access" on task_photos;
drop policy if exists "anon full access" on sticky_notes;
drop policy if exists "anon full access to task-photos" on storage.objects;
create policy "team only" on tasks for all to authenticated using ((auth.jwt() ->> 'email') = 'mary@ccabinet.com') with check ((auth.jwt() ->> 'email') = 'mary@ccabinet.com');
create policy "team only" on daily_review for all to authenticated using ((auth.jwt() ->> 'email') = 'mary@ccabinet.com') with check ((auth.jwt() ->> 'email') = 'mary@ccabinet.com');
create policy "team only" on task_photos for all to authenticated using ((auth.jwt() ->> 'email') = 'mary@ccabinet.com') with check ((auth.jwt() ->> 'email') = 'mary@ccabinet.com');
create policy "team only" on sticky_notes for all to authenticated using ((auth.jwt() ->> 'email') = 'mary@ccabinet.com') with check ((auth.jwt() ->> 'email') = 'mary@ccabinet.com');
create policy "team only task-photos" on storage.objects for all to authenticated using (bucket_id = 'task-photos' and (auth.jwt() ->> 'email') = 'mary@ccabinet.com') with check (bucket_id = 'task-photos' and (auth.jwt() ->> 'email') = 'mary@ccabinet.com');

-- EHL task contact fields (shown in his task details; the Claude connector
-- can fill them too).
alter table tasks add column if not exists sf_url text;
alter table tasks add column if not exists website text;  -- Mary's task contact box
alter table tasks add column if not exists snooze_until date;  -- "Push out": hidden from its list until this day
alter table tasks add column if not exists phone text;
alter table tasks add column if not exists email text;

-- EHL Hand-offs: what Mary is waiting on for a task EHL handed her (Reply,
-- Quote, Document, ...). EHL's own extra reasons are sticky_notes rows with
-- color = 'reason'.
alter table tasks add column if not exists waiting_on text;

-- Repeating tasks: 'daily' | 'weekdays' | 'weekly' | 'monthly'. Checking one
-- off creates the next copy with the next due date.
alter table tasks add column if not exists repeat text;
