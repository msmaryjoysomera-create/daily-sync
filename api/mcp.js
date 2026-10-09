// Remote MCP server for "Sync Up" -- lets Claude add/list tasks on the
// shared board directly from chat (e.g. "add a task for Mary to follow up
// with Adria about the template"). Add this endpoint's URL as a custom
// connector in Claude's settings.
//
// Talks to the same Supabase project as index.html, with the same anon key
// (already public/RLS-open by design -- see supabase-setup.sql). No auth
// of its own, matching the app's existing "no login, shared link" model.
//
// Hand-rolls the MCP JSON-RPC methods it needs (initialize, tools/list,
// tools/call) over a single stateless HTTP endpoint, rather than pulling in
// the full MCP SDK's transport classes, which assume a raw Node HTTP
// server and don't always play nicely with serverless request/response
// wrappers.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aighvqegtxgpvltwosmn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZ2h2cWVndHhncHZsdHdvc21uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Nzc5OTMsImV4cCI6MjEwNTA1Mzk5M30.HakqVLbQpRZQ8VNbkqja74lDiw_jWB4D4fuYB8JfEso';

// Fallback only -- the live tag list is read from the board (see currentTags).
const TAG_OPTIONS = ['Hot Topics', 'Non-Urgent', 'Follow Up', 'Schedule Pending', 'Mary - Open Items', 'Orders/Deliveries', 'Returns/Credits', 'Appointments', 'Dinner Reservations', 'Deliverables'];

// Once the board is locked (RLS: signed-in team only), this server needs its
// own key: SUPABASE_SERVICE_ROLE_KEY, set in Vercel's environment variables.
// If MCP_KEY is set there too, callers must add ?key=<MCP_KEY> to the URL,
// so only Mary's and Evan's Claude connectors can use it.
const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Links are saved with https:// added if it was left off.
// Several phones / emails are saved one per line (the app shows each as its own link).
const contactList = (v, sep) => { const vals = [...new Set(String(v || '').split(sep).map(s => s.trim()).filter(Boolean))]; return vals.length ? vals.join('\n') : null; };
const asLink = v => { const s = v ? String(v).trim() : ''; return s ? (/^https?:\/\//i.test(s) ? s : 'https://' + s) : null; };

// Mary's tags are saved as sticky_notes rows marked color 'tag' (body = sort
// order), and can be added/renamed/deleted in the app.
// Evan's own lists are rows with assignee 'evan'.
async function currentTags() {
  const { data, error } = await sb.from('sticky_notes').select('title,body,assignee').eq('color', 'tag');
  if (error || !data?.length) return { mary: TAG_OPTIONS, evan: [], sarah: [] };
  const sorted = data.sort((a, b) => (Number(a.body) || 0) - (Number(b.body) || 0));
  return {
    mary: sorted.filter(r => (r.assignee || 'mary') === 'mary').map(r => r.title),
    evan: sorted.filter(r => r.assignee === 'evan').map(r => r.title),
    // Sarah's "To Do" is her default list (tasks with no list of their own).
    sarah: ['To Do', ...sorted.filter(r => r.assignee === 'sarah').map(r => r.title)],
  };
}

const buildTools = ({ mary: tags, evan: evanLists, sarah: sarahLists }) => [
  {
    name: 'sync_up_add_task',
    description: `Add a task to "Sync Up" -- Columbia Cabinets' own daily task tracker/checklist app for Mary, Sarah, and EHL (Evan) (not Salesforce, not a CRM, not any other task/to-do system). Use this specifically when asked to add something "to Sync Up" or "to the board", or when no other task system is named and the context is clearly Mary/Sarah's daily sync. Every task needs a person AND a list. Lists per person -- Mary: ${tags.join(', ')}. EHL (Evan): ${evanLists.join(', ') || '(none yet)'}. Sarah: ${sarahLists.join(', ')}. If the user didn't say which list, ASK them (offer that person's lists) before adding -- never guess or default to the first list.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, e.g. "Follow up with Adria about Template"' },
        assignee: { type: 'string', enum: ['mary', 'sarah', 'evan'], description: 'Who the task is for ("evan" = EHL, also called Evan). Required: if the user did not say whose task it is, ask them (EHL, Mary, or Sarah?) before adding.' },
        tag: { type: 'string', description: "Which of that person's lists the task goes in -- exactly one of the names listed above. Required: if the user didn't say, ask which list before adding." },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format, only if a date was mentioned' },
        notes: { type: 'string', description: 'Extra context or notes for the task' },
        phone: { type: 'string', description: "Contact phone number(s) for the task, if mentioned (e.g. '336-686-5090'). Separate several with commas." },
        email: { type: 'string', description: 'Contact email address(es) for the task, if mentioned. Separate several with commas.' },
        salesforce_url: { type: 'string', description: 'Link to the related Salesforce record, if one was given' },
        website: { type: 'string', description: 'Website link for the task (e.g. a company or product site), if one was given. Shown on Mary\'s tasks.' },
        repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'], description: 'If the task repeats. Works like Outlook: e.g. "every Monday and Thursday" = weekly with repeat_days; "every 2 weeks" = weekly with repeat_every 2; monthly/yearly repeat on the due date\'s day.' },
        repeat_every: { type: 'integer', minimum: 1, maximum: 99, description: 'Repeat every N days/weeks/months/years (default 1)' },
        repeat_days: { type: 'array', items: { type: 'string', enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] }, description: 'For weekly: which days of the week' },
        repeat_until: { type: 'string', description: 'Last date it can repeat (YYYY-MM-DD), if an end date was given' },
        repeat_times: { type: 'integer', minimum: 1, description: 'End after this many times, if given' },
      },
      required: ['title', 'assignee', 'tag'],
    },
  },
  {
    name: 'sync_up_push_out',
    description: 'Push out (snooze) one of Mary\'s or EHL\'s open Sync Up tasks until a date: it leaves its list and comes back to the same list on that date, with a "Back today" label. Also brings a pushed-out task back early (until: "now"). Not available for Sarah\'s tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task\'s title, or a distinctive part of it (e.g. "Yale"). If several open tasks match, you\'ll get the list back -- ask the user which one.' },
        assignee: { type: 'string', enum: ['mary', 'evan'], description: 'Whose task it is ("evan" = EHL). Optional, narrows the match.' },
        until: { type: 'string', description: '"tomorrow", "next_week" (the coming Monday), "next_month" (first weekday of next month), a date in YYYY-MM-DD format, or "now" to bring it back right away.' },
      },
      required: ['task', 'until'],
    },
  },
  {
    name: 'sync_up_list_tasks',
    description: 'List current open (not-done) tasks on "Sync Up" -- Columbia Cabinets\' own daily task tracker for Mary, Sarah, and EHL (Evan) (not Salesforce, not a CRM). Optionally filtered to one person.',
    inputSchema: {
      type: 'object',
      properties: {
        assignee: { type: 'string', enum: ['mary', 'sarah', 'evan'], description: 'Only list tasks assigned to this person ("evan" = EHL, also called Evan)' },
      },
    },
  },
];

function personName(v) {
  return { mary: 'Mary', sarah: 'Sarah', evan: 'EHL' }[v] || null;
}

// Dates for "push out" in the team's own time zone (the server runs on UTC).
const TEAM_TZ = 'America/New_York';
function teamToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}
const ymd = d => d.toISOString().slice(0, 10);
function pushDate(until) {
  const u = String(until || '').trim().toLowerCase().replace(/\s+/g, '_');
  const today = teamToday();
  const d = new Date(today);
  if (u === 'now') return null;
  if (u === 'tomorrow') { d.setUTCDate(d.getUTCDate() + 1); return ymd(d); }
  if (u === 'next_week') { d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return ymd(d); }
  if (u === 'next_month') {
    const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    while (f.getUTCDay() === 0 || f.getUTCDay() === 6) f.setUTCDate(f.getUTCDate() + 1);
    return ymd(f);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(u) && u > ymd(today)) return u;
  return undefined; // not understood (or not in the future)
}

// Repeat rules, saved the way the app's Repeat window (Outlook-style) saves them.
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function buildRepeat(args, due) {
  const kind = args.repeat;
  if (!['daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(kind)) return { rule: null, due: due || null, label: '' };
  const base = /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? new Date(due + 'T00:00:00Z') : teamToday();
  const n = Math.min(99, Math.max(1, parseInt(args.repeat_every, 10) || 1));
  let r, label;
  if (kind === 'daily') { r = { f: 'daily', n }; label = n === 1 ? 'daily' : `every ${n} days`; }
  else if (kind === 'weekdays') { r = { f: 'daily', n: 1, wd: true }; label = 'every weekday'; }
  else if (kind === 'weekly') {
    const days = [...new Set((args.repeat_days || []).map(d => DAY_NAMES.indexOf(String(d).toLowerCase())).filter(i => i >= 0))].sort();
    r = { f: 'weekly', n, days: days.length ? days : [base.getUTCDay()] };
    label = `${n === 1 ? 'weekly' : `every ${n} weeks`} on ${r.days.map(i => DAY_NAMES[i][0].toUpperCase() + DAY_NAMES[i].slice(1, 3)).join(', ')}`;
  } else if (kind === 'monthly') { r = { f: 'monthly', n, m: 'day', day: base.getUTCDate() }; label = `${n === 1 ? 'monthly' : `every ${n} months`} on day ${r.day}`; }
  else { r = { f: 'yearly', n, mo: base.getUTCMonth(), day: base.getUTCDate() }; label = n === 1 ? 'yearly' : `every ${n} years`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(args.repeat_until || '')) { r.until = args.repeat_until; label += ` until ${r.until}`; }
  if (parseInt(args.repeat_times, 10) > 0) { r.left = parseInt(args.repeat_times, 10); label += `, ${r.left} times`; }
  // First due date: the first day on/after the start that fits (e.g. the next Monday).
  const d = new Date(base);
  const fits = () => r.f === 'weekly' ? r.days.includes(d.getUTCDay()) : r.wd ? d.getUTCDay() % 6 !== 0 : true;
  for (let i = 0; i < 14 && !fits(); i++) d.setUTCDate(d.getUTCDate() + 1);
  return { rule: r, due: ymd(d), label };
}

async function callTool(name, args) {
  if (name === 'sync_up_push_out') {
    const date = pushDate(args?.until);
    if (date === undefined) return { content: [{ type: 'text', text: 'Give "until" as tomorrow, next_week, next_month, a future date (YYYY-MM-DD), or "now".' }], isError: true };
    const words = String(args?.task || '').trim();
    if (!words) return { content: [{ type: 'text', text: 'Which task? Give its title.' }], isError: true };
    let q = sb.from('tasks').select('id,title,tag,assignee,snooze_until').neq('status', 'done').in('assignee', ['mary', 'evan']).ilike('title', `%${words.replace(/[\\%_]/g, '\\$&')}%`); // % and _ typed in a title are literal
    if (args?.assignee) q = q.eq('assignee', args.assignee);
    const { data, error } = await q;
    if (error) return { content: [{ type: 'text', text: `Couldn't look up the task: ${error.message}` }], isError: true };
    const exact = data.filter(t => t.title.toLowerCase() === words.toLowerCase());
    const matches = exact.length === 1 ? exact : data;
    if (!matches.length) return { content: [{ type: 'text', text: `No open task of Mary's or EHL's matches "${words}".` }], isError: true };
    if (matches.length > 1) {
      return { content: [{ type: 'text', text: `Several open tasks match "${words}" -- ask the user which one, then try again with its full title:\n` + matches.map(t => `- ${t.title} [${t.tag || 'no list'}] (${personName(t.assignee)})`).join('\n') }], isError: true };
    }
    const t = matches[0];
    const { error: upErr } = await sb.from('tasks').update({ snooze_until: date }).eq('id', t.id);
    if (upErr) return { content: [{ type: 'text', text: `Couldn't push it out: ${upErr.message}` }], isError: true };
    const where = t.tag || (t.assignee === 'evan' ? 'Tasks' : 'Untagged');
    return { content: [{ type: 'text', text: date
      ? `Pushed out "${t.title}" (${personName(t.assignee)}) until ${date}. It comes back to "${where}" that day.`
      : `Brought "${t.title}" (${personName(t.assignee)}) back to "${where}".` }] };
  }


  if (name === 'sync_up_add_task') {
    const title = (args?.title || '').trim();
    if (!title) return { content: [{ type: 'text', text: 'A task title is required.' }], isError: true };
    // Every task needs a person: one with none shows up in nobody's list.
    if (!['mary', 'sarah', 'evan'].includes(args?.assignee)) {
      return { content: [{ type: 'text', text: 'Whose task is this: EHL, Mary, or Sarah? Ask the user, then add it again with assignee set.' }], isError: true };
    }

    // ...and a list: one of that person's existing lists, so nothing lands in
    // a made-up list or a default the user didn't pick.
    const lists = (await currentTags())[args.assignee];
    const name = personName(args.assignee);
    const asked = String(args.tag || '').trim();
    if (!asked) {
      return { content: [{ type: 'text', text: `Which list should this go in? ${name}'s lists: ${lists.join(', ')}. Ask the user, then add it again with tag set.` }], isError: true };
    }
    const list = lists.find(l => l.toLowerCase() === asked.toLowerCase());
    if (!list) {
      return { content: [{ type: 'text', text: `"${asked}" isn't one of ${name}'s lists (${lists.join(', ')}). Ask the user which one to use.` }], isError: true };
    }
    const tag = args.assignee === 'sarah' && list === 'To Do' ? null : list;

    const rep = buildRepeat(args, args.due_date || null);
    const { data, error } = await sb.from('tasks').insert({
      title,
      assignee: args.assignee,
      tag,
      due_date: rep.due,
      notes: args.notes ? String(args.notes).trim() : null,
      phone: contactList(args.phone, /\s*[;\n]\s*|\s*,\s*(?=[+(\d])/),
      email: contactList(args.email, /[\s,;]+/),
      sf_url: asLink(args.salesforce_url),
      website: asLink(args.website),
      repeat: rep.rule ? JSON.stringify(rep.rule) : null,
      status: 'todo',
      source: 'claude',
    }).select().single();
    if (error) return { content: [{ type: 'text', text: `Couldn't add the task: ${error.message}` }], isError: true };

    const who = personName(data.assignee);
    const bits = [`Added "${data.title}" to Sync Up`];
    if (who) bits.push(`for ${who}`);
    if (data.tag) bits.push(`under "${data.tag}"`);
    if (data.due_date) bits.push(`due ${data.due_date}`);
    if (rep.rule) bits.push(`repeating ${rep.label}`);
    const contact = [data.phone && 'phone', data.email && 'email', data.sf_url && 'Salesforce link', data.website && 'website'].filter(Boolean);
    if (contact.length) bits.push(`with ${contact.join(', ')}`);
    return { content: [{ type: 'text', text: bits.join(' ') + '.' }] };
  }

  if (name === 'sync_up_list_tasks') {
    let q = sb.from('tasks').select('title,tag,assignee,due_date,status,snooze_until').neq('status', 'done').order('created_at', { ascending: true });
    if (args?.assignee) q = q.eq('assignee', args.assignee);
    const { data, error } = await q;
    if (error) return { content: [{ type: 'text', text: `Couldn't list tasks: ${error.message}` }], isError: true };
    if (!data.length) return { content: [{ type: 'text', text: 'No open tasks.' }] };

    const lines = data.map(t => {
      const who = personName(t.assignee) || 'Unassigned';
      const parts = [`- ${t.title}`];
      if (t.tag) parts.push(`[${t.tag}]`);
      parts.push(`(${who}${t.status === 'doing' ? ', in progress' : ''})`);
      if (t.due_date) parts.push(`due ${t.due_date}`);
      if (t.snooze_until && t.snooze_until > ymd(teamToday())) parts.push(`-- pushed out until ${t.snooze_until} (hidden from its list until then)`);
      return parts.join(' ');
    });
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const requiredKey = process.env.MCP_KEY;
  if (requiredKey && req.query?.key !== requiredKey) { res.status(401).json({ error: 'Missing or wrong connector key' }); return; }
  if (req.method === 'GET') { res.status(200).json({ status: 'ok', server: 'sync-up-mcp' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body || {};
  const { id, method, params } = body;
  const respond = (result) => res.status(200).json({ jsonrpc: '2.0', id, result });
  const respondError = (code, message) => res.status(200).json({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    if (method === 'initialize') {
      respond({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'sync-up', version: '1.0.0' },
      });
      return;
    }
    if (method === 'notifications/initialized') { res.status(202).end(); return; }
    if (method === 'tools/list') { respond({ tools: buildTools(await currentTags()) }); return; }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      respond(await callTool(name, args || {}));
      return;
    }
    if (method === 'ping') { respond({}); return; }

    respondError(-32601, `Method not found: ${method}`);
  } catch (err) {
    respondError(-32603, err.message || 'Internal error');
  }
}
