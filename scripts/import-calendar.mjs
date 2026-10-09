// Copies EHL's Outlook calendar into Sync Up (table calendar_events) for
// Mary's Daily Review. Run by a scheduled Claude task, which reads the
// calendar with the Outlook connector and saves the events as JSON first:
//
//   node scripts/import-calendar.mjs events.json --from 2026-09-29 --to 2026-10-11
//
// events.json: an array of events exactly as outlook_calendar_search returns
// them ({ id, subject, start: { dateTime, timeZone }, end, location, summary,
// organizer, attendees, categories, isAllDay, isCancelled }). Events in the
// --from/--to window that are no longer in Outlook (deleted or moved) are
// removed; "Discussed" and "task made" marks on the others are kept.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aighvqegtxgpvltwosmn.supabase.co';
const KEY_FILE = join(homedir(), '.config', 'sync-up', 'service-key');
const TEAM_TZ = 'America/New_York';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const from = opt('from'), to = opt('to');
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
  console.error('Usage: node scripts/import-calendar.mjs events.json --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exit(1);
}

// Outlook gives wall-clock times plus a Windows zone name; the team is on
// Eastern time, so read "Eastern Standard Time" (and UTC) into real instants.
function toInstant(dt) {
  if (!dt?.dateTime) return null;
  const wall = dt.dateTime.replace(/\.\d+$/, '');
  if (/^(UTC|Coordinated Universal Time)$/i.test(dt.timeZone || '')) return new Date(wall + 'Z').toISOString();
  // Find the New York offset at that wall-clock time.
  const guess = new Date(wall + 'Z');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(guess).map(p => [p.type, p.value]));
  const asNY = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess.getTime() + (guess.getTime() - asNY)).toISOString();
}
// Teams join blocks (links, meeting IDs, passcodes) aren't notes.
const cleanNotes = s => {
  const text = String(s || '').replace(/\r/g, '').split(/_{8,}/)[0].trim();
  return text ? text.slice(0, 600) : null;
};
const windowStart = toInstant({ dateTime: from + 'T00:00:00', timeZone: 'Eastern Standard Time' });
const windowEnd = toInstant({ dateTime: to + 'T23:59:59', timeZone: 'Eastern Standard Time' });

const raw = JSON.parse(readFileSync(file, 'utf8'));
const events = (Array.isArray(raw) ? raw : raw.events || [])
  .filter(e => e && e.id && e.start && !e.isCancelled)
  .map(e => ({
    id: e.id,
    owner: 'evan',
    subject: e.subject || '(no title)',
    start_at: toInstant(e.start),
    end_at: toInstant(e.end),
    is_all_day: !!e.isAllDay,
    location: e.location || null,
    notes: cleanNotes(e.summary || e.bodyPreview),
    organizer: e.organizer || null,
    attendees: Array.isArray(e.attendees) ? e.attendees : null,
    categories: Array.isArray(e.categories) ? e.categories : null,
    imported_at: new Date().toISOString(),
  }))
  .filter(e => e.start_at);

const sb = createClient(SUPABASE_URL, readFileSync(KEY_FILE, 'utf8').trim(), { auth: { persistSession: false } });
if (events.length) {
  const { error } = await sb.from('calendar_events').upsert(events, { onConflict: 'id' });
  if (error) { console.error('Save failed:', error.message); process.exit(1); }
}
// Drop events in the window that Outlook no longer has.
const { data: existing, error: listErr } = await sb.from('calendar_events').select('id').eq('owner', 'evan').gte('start_at', windowStart).lte('start_at', windowEnd);
if (listErr) { console.error('List failed:', listErr.message); process.exit(1); }
const keep = new Set(events.map(e => e.id));
const gone = existing.map(r => r.id).filter(id => !keep.has(id));
if (gone.length) {
  const { error } = await sb.from('calendar_events').delete().in('id', gone);
  if (error) { console.error('Cleanup failed:', error.message); process.exit(1); }
}
console.log(`Saved ${events.length} events (${from} to ${to}); removed ${gone.length} no longer in Outlook.`);
