# Builds daily-sync/test-mock.html: the real app, with Supabase answered by an
# in-memory fake (pretend data), so the UI can be tested without the passcode.
# Usage (from the repo root): python3 scripts/make-test-page.py [mary|sarah|evan]
# then open http://localhost:8934/test-mock.html (python3 -m http.server 8934).
# test-mock.html is git-ignored; it never touches the real database.
import json, sys, datetime
who = sys.argv[1] if len(sys.argv) > 1 else 'mary'
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
def task(i, title, assignee, tag=None, status='todo'):
    return {"id": f"t{i}", "title": title, "assignee": assignee, "tag": tag, "status": status, "notes": None,
            "due_date": None, "created_at": now, "updated_at": now, "completed_at": None, "completed_by": None,
            "pinned": False, "recurring": False, "steps": [], "position": None, "my_day": None, "source": None}
db = {
  "tasks": [task(1, "MOCK Mary follow up", "mary", "Follow Up"), task(2, "MOCK Sarah to do", "sarah"),
            task(3, "MOCK Sarah doing", "sarah", None, "doing"), task(4, "MOCK EHL task", "evan"),
            task(5, "MOCK EHL call client", "evan", "Follow Up"), task(6, "MOCK EHL deck", "evan", "Projects"),
            {**task(7, "MOCK EHL starred", "evan", "Follow Up"), "pinned": True}, task(8, "MOCK EHL finished", "evan", "Projects", "done")],
  "sticky_notes": [{"id": "g1", "assignee": None, "color": "tag", "title": "Follow Up", "body": "0", "created_at": now, "updated_at": now},
                   {"id": "g2", "assignee": "evan", "color": "tag", "title": "Follow Up", "body": "0", "created_at": now, "updated_at": now},
                   {"id": "g3", "assignee": "evan", "color": "tag", "title": "Projects", "body": "1", "created_at": now, "updated_at": now},
                   {"id": "g4", "assignee": "evan", "color": "tag", "title": "Schedule", "body": "2", "created_at": now, "updated_at": now}],
  "task_photos": [], "daily_review": [],
}
c = open('/Users/marysomera/daily-sync/index.html').read()
inject = """<script>
localStorage.setItem('daily-sync-who', %s);
localStorage.setItem('daily-sync-auth', 'mock-refresh');
window.__db = %s;
const __real = window.fetch;
let __n = 100;
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  if (!url.hostname.endsWith('supabase.co')) return __real(input, init);
  const hdrs = new Headers(init.headers || {});
  const single = (hdrs.get('accept') || '').includes('vnd.pgrst.object');
  const json = (body, status = 200) => new Response(JSON.stringify(single && Array.isArray(body) ? body[0] ?? null : body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname.startsWith('/auth/v1/')) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return json({ access_token: 'mock', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      user: { id: 'u1', email: 'mary@ccabinet.com', aud: 'authenticated', role: 'authenticated' } });
  }
  const table = url.pathname.split('/').pop();
  const rows = window.__db[table] || (window.__db[table] = []);
  const method = (init.method || 'GET').toUpperCase();
  const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const match = r => filters.every(([k, v]) => { const [op, ...rest] = v.split('.'); const val = rest.join('.');
    if (op === 'eq') return String(r[k]) === val; if (op === 'is') return r[k] === null; if (op === 'in') return val.replace(/[()]/g,'').split(',').includes(String(r[k])); return true; });
  if (method === 'GET' || method === 'HEAD') return json(rows.filter(match));
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(b => ({ id: 'n' + (++__n), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b }));
    list.forEach(r => { const i = rows.findIndex(x => x.id === r.id || (table === 'daily_review' && x.day === r.day && x.item === r.item)); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r); });
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); window.__db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};
</script>
""" % (json.dumps(who), json.dumps(db))
open('/Users/marysomera/daily-sync/test-mock.html', 'w').write(c.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n' + inject, 1))
print('test-mock.html written for', who)
