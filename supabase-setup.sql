-- Daily Sync -- Supabase table setup
-- No auth: this is a shared-link tool for two people, so the anon key gets
-- full read/write access to the tasks table. Don't reuse this key/project
-- for anything that needs real access control.

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

