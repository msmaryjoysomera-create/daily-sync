-- Daily Sync -- Supabase table setup
-- No auth: this is a shared-link tool for two people, so the anon key gets
-- full read/write access to the tasks table. Don't reuse this key/project
-- for anything that needs real access control.

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  assignee     text,
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
-- per calendar day, shared between Mary and Evan, resets each new day.
create table daily_review (
  day date not null,
  item text not null,
  checked boolean not null default false,
  primary key (day, item)
);

alter table daily_review enable row level security;

create policy "anon full access" on daily_review for all using (true) with check (true);

alter publication supabase_realtime add table daily_review;

