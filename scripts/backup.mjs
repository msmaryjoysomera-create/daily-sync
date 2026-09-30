// Saves everything on Sync Up -- Mary's and Sarah's tasks (open and done,
// with notes and photos), sticky notes, notepads, and today's Daily Review
// -- into one Word doc. Run on a schedule by a launchd job on Mary's Mac
// (see scripts/com.columbiacabinets.syncup-backup.plist), 8am and 5pm.
//
//   node scripts/backup.mjs            -> ~/Documents/Sync Up Backups/
//   SYNC_UP_BACKUP_DIR=/some/dir node scripts/backup.mjs

import { createClient } from '@supabase/supabase-js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from 'docx';
import { imageSize } from 'image-size';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL = 'https://aighvqegtxgpvltwosmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZ2h2cWVndHhncHZsdHdvc21uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Nzc5OTMsImV4cCI6MjEwNTA1Mzk5M30.HakqVLbQpRZQ8VNbkqja74lDiw_jWB4D4fuYB8JfEso';

// Keep in sync with index.html.
const TAG_OPTIONS = ['Hot Topics', 'Non-Urgent', 'Follow Up', 'Schedule Pending', 'Mary - Open Items', 'Orders/Deliveries', 'Returns/Credits', 'Appointments', 'Dinner Reservations', 'Deliverables'];
const REVIEW_ITEMS = ['Calendar', 'Tasks', 'Tasks – Completed', 'Inbox', 'Text Messages', 'Photos'];
const NOTEPAD_MARK = 'notepad';
const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done' };
const STATUS_ICON = { todo: '☐', doing: '◐', done: '☑' };

const outDir = process.env.SYNC_UP_BACKUP_DIR || path.join(os.homedir(), 'Documents', 'Sync Up Backups');

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const localDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDate = s => new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = s => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function timeLabel(d) {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? '.' + String(m).padStart(2, '0') : ''}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

const heading = (text, level) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 80 } });
const muted = text => new TextRun({ text, color: '777777', size: 18 });
const empty = text => new Paragraph({ children: [muted(text)] });

// Keeps line breaks from notes/notepad text.
function multiline(text, opts = {}) {
  const lines = String(text).split('\n');
  return new Paragraph({
    ...opts,
    children: lines.map((line, i) => new TextRun({ text: line, break: i ? 1 : 0 })),
  });
}

async function photoParagraphs(photos) {
  const out = [];
  for (const p of photos) {
    try {
      const res = await fetch(p.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      const { width, height, type } = imageSize(data);
      const scale = Math.min(1, 320 / width);
      out.push(new Paragraph({
        indent: { left: 360 },
        spacing: { after: 80 },
        children: [new ImageRun({ type: type === 'jpg' || type === 'jpeg' ? 'jpg' : type, data, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })],
      }));
    } catch (err) {
      out.push(new Paragraph({ indent: { left: 360 }, children: [muted(`Photo (couldn't embed: ${err.message}): ${p.url}`)] }));
    }
  }
  return out;
}

async function taskParagraphs(task, photosByTask) {
  const meta = [STATUS_LABEL[task.status] || task.status];
  if (task.due_date) meta.push(`Due ${fmtDate(task.due_date)}`);
  if (task.tag) meta.push(`Tag: ${task.tag}`);
  if (task.recurring) meta.push('Repeats daily');
  if (task.pinned) meta.push('Pinned');
  if (task.source === 'claude') meta.push('Added via Claude');
  if (task.created_at) meta.push(`Added ${fmtDate(task.created_at)}`);
  if (task.status === 'done' && task.completed_at) {
    meta.push(`Completed ${fmtDateTime(task.completed_at)}${task.completed_by ? ` by ${task.completed_by[0].toUpperCase()}${task.completed_by.slice(1)}` : ''}`);
  }

  const out = [
    new Paragraph({
      spacing: { before: 120 },
      children: [new TextRun({ text: `${STATUS_ICON[task.status] || '☐'}  ${task.title}`, bold: true })],
    }),
    new Paragraph({ indent: { left: 360 }, children: [muted(meta.join('  ·  '))] }),
  ];
  if (task.notes) out.push(multiline(task.notes, { indent: { left: 360 }, spacing: { before: 40 } }));
  out.push(...await photoParagraphs(photosByTask.get(task.id) || []));
  return out;
}

async function personSection(name, key, { tasks, photosByTask, stickies }) {
  const mine = tasks.filter(t => t.assignee === key);
  const open = mine.filter(t => t.status !== 'done');
  const done = mine.filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  const out = [heading(name, HeadingLevel.HEADING_1)];

  out.push(heading(`Open tasks (${open.length})`, HeadingLevel.HEADING_2));
  if (!open.length) out.push(empty('No open tasks'));
  // Mary's board is organized by tag; Sarah's by status.
  const groups = key === 'mary'
    ? [...new Set([...TAG_OPTIONS, ...stickies.filter(n => n.color === 'tag').map(n => n.title), ...open.map(t => t.tag).filter(Boolean)]), null]
        .map(tag => ({ label: tag || 'Untagged', items: open.filter(t => (t.tag || null) === tag) }))
    : [{ label: 'To Do', items: open.filter(t => t.status === 'todo') }, { label: 'In Progress', items: open.filter(t => t.status === 'doing') }];
  for (const g of groups) {
    if (!g.items.length) continue;
    out.push(heading(`${g.label} (${g.items.length})`, HeadingLevel.HEADING_3));
    for (const t of g.items) out.push(...await taskParagraphs(t, photosByTask));
  }

  out.push(heading(`Done (${done.length})`, HeadingLevel.HEADING_2));
  if (!done.length) out.push(empty('Nothing completed'));
  for (const t of done) out.push(...await taskParagraphs(t, photosByTask));

  const notes = stickies.filter(n => n.assignee === key && n.color !== NOTEPAD_MARK && n.color !== 'tag');
  out.push(heading(`Sticky Wall (${notes.length})`, HeadingLevel.HEADING_2));
  if (!notes.length) out.push(empty('No sticky notes'));
  for (const n of notes) {
    out.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: n.title || 'Untitled note', bold: true })] }));
    if (n.body) out.push(multiline(n.body, { indent: { left: 360 } }));
  }

  const pad = stickies.find(n => n.assignee === key && n.color === NOTEPAD_MARK);
  out.push(heading('Notepad', HeadingLevel.HEADING_2));
  out.push(pad?.body ? multiline(pad.body) : empty('Empty'));
  if (pad?.updated_at) out.push(new Paragraph({ children: [muted(`Last edited ${fmtDateTime(pad.updated_at)}`)] }));

  return out;
}

async function main() {
  const now = new Date();
  const today = localDateStr(now);
  const [tasks, photos, stickies, review] = await Promise.all([
    must(sb.from('tasks').select('*').order('created_at', { ascending: true })),
    must(sb.from('task_photos').select('*').order('created_at', { ascending: true })),
    must(sb.from('sticky_notes').select('*').order('created_at', { ascending: true })),
    must(sb.from('daily_review').select('*').eq('day', today)),
  ]);
  const photosByTask = new Map();
  for (const p of photos) {
    if (!photosByTask.has(p.task_id)) photosByTask.set(p.task_id, []);
    photosByTask.get(p.task_id).push(p);
  }
  const data = { tasks, photosByTask, stickies };

  const checked = new Set(review.filter(r => r.checked).map(r => r.item));
  const children = [
    new Paragraph({ text: 'Sync Up Backup', heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [muted(now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))] }),
    heading("Today's Daily Review", HeadingLevel.HEADING_2),
    ...REVIEW_ITEMS.map(item => new Paragraph({ text: `${checked.has(item) ? '☑' : '☐'}  ${item}` })),
    ...await personSection('Mary', 'mary', data),
    ...await personSection('Sarah', 'sarah', data),
  ];
  const unassigned = tasks.filter(t => t.assignee !== 'mary' && t.assignee !== 'sarah');
  if (unassigned.length) {
    children.push(heading(`Unassigned tasks (${unassigned.length})`, HeadingLevel.HEADING_1));
    for (const t of unassigned) children.push(...await taskParagraphs(t, photosByTask));
  }

  const doc = new Document({
    creator: 'Sync Up',
    title: `Sync Up Backup ${today}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children }],
  });

  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `Sync Up Backup ${today} ${timeLabel(now)}.docx`);
  await fs.writeFile(file, await Packer.toBuffer(doc));
  console.log(`${now.toISOString()} saved ${file} (${tasks.length} tasks, ${photos.length} photos)`);
}

main().catch(err => {
  console.error(`${new Date().toISOString()} backup failed: ${err.message}`);
  process.exit(1);
});
