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

const TAG_OPTIONS = ['Hot Topics', 'Non-Urgent', 'Follow Up', 'Schedule Pending', 'Mary - Open Items', 'Orders/Deliveries', 'Returns/Credits', 'Appointments', 'Dinner Reservations', 'Deliverables'];

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, lock: (name, timeout, fn) => fn() },
});

const TOOLS = [
  {
    name: 'add_task',
    description: `Add a task to the "Sync Up" shared board -- Columbia Cabinets' daily task tracker for Mary and Sarah. Use this when asked to add, create, or note down a task, reminder, or follow-up for Mary or Sarah. Existing categories on the board: ${TAG_OPTIONS.join(', ')}. Reuse one of these exactly when it clearly fits, instead of inventing a new one.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title, e.g. "Follow up with Adria about Template"' },
        assignee: { type: 'string', enum: ['mary', 'sarah'], description: 'Who the task is for, if a specific person was named' },
        tag: { type: 'string', description: 'Category for the task -- prefer an existing category listed above when it fits' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format, only if a date was mentioned' },
        notes: { type: 'string', description: 'Extra context or notes for the task' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List current open (not-done) tasks on the Sync Up board, optionally filtered to one person.',
    inputSchema: {
      type: 'object',
      properties: {
        assignee: { type: 'string', enum: ['mary', 'sarah'], description: 'Only list tasks assigned to this person' },
      },
    },
  },
];

function personName(v) {
  return v === 'mary' ? 'Mary' : v === 'sarah' ? 'Sarah' : null;
}

async function callTool(name, args) {
  if (name === 'add_task') {
    const title = (args?.title || '').trim();
    if (!title) return { content: [{ type: 'text', text: 'A task title is required.' }], isError: true };

    const { data, error } = await sb.from('tasks').insert({
      title,
      assignee: args.assignee || null,
      tag: args.tag ? String(args.tag).trim() : null,
      due_date: args.due_date || null,
      notes: args.notes ? String(args.notes).trim() : null,
      status: 'todo',
    }).select().single();
    if (error) return { content: [{ type: 'text', text: `Couldn't add the task: ${error.message}` }], isError: true };

    const who = personName(data.assignee);
    const bits = [`Added "${data.title}" to Sync Up`];
    if (who) bits.push(`for ${who}`);
    if (data.tag) bits.push(`under "${data.tag}"`);
    if (data.due_date) bits.push(`due ${data.due_date}`);
    return { content: [{ type: 'text', text: bits.join(' ') + '.' }] };
  }

  if (name === 'list_tasks') {
    let q = sb.from('tasks').select('title,tag,assignee,due_date,status').neq('status', 'done').order('created_at', { ascending: true });
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
    if (method === 'tools/list') { respond({ tools: TOOLS }); return; }
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
