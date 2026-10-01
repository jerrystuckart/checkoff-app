// In-memory stand ins for Supabase and Resend, used only by tests and the smoke test. They enforce the
// campaign_sends uniqueness rule the production index enforces, so idempotency is tested for real.

export type Op = { table: string; op: 'insert' | 'update' | 'select' | 'delete' | 'rpc'; payload?: any; filters?: [string, any][] };

export class FakeDb {
  tables: Record<string, any[]> = {};
  rpcs: Record<string, any> = {};
  ops: Op[] = [];
  nextId = 1;
  failUpdate: ((table: string, payload: any) => boolean) | null = null;

  constructor(seed: Record<string, any[]> = {}) { for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r })); }

  rows(t: string) { return (this.tables[t] ||= []); }
  writes() { return this.ops.filter((o) => o.op === 'insert' || o.op === 'update' || o.op === 'delete'); }

  rpc(name: string, args: any) {
    this.ops.push({ table: name, op: 'rpc', payload: args });
    const v = this.rpcs[name];
    return Promise.resolve(v === undefined ? { data: null, error: { message: `no rpc ${name}` } } : { data: typeof v === 'function' ? v(args) : v, error: null });
  }

  from(table: string) {
    const db = this;
    const state: { op: Op['op']; payload?: any; filters: [string, any][]; single: boolean; maybe: boolean; head: boolean; wantRows: boolean; count: boolean } =
      { op: 'select', filters: [], single: false, maybe: false, head: false, wantRows: false, count: false };
    const matches = (r: any) => state.filters.every(([c, v]) => !(c in r) && c.includes('.') ? true : (Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
    const run = () => {
      const t = db.rows(table);
      db.ops.push({ table, op: state.op, payload: state.payload, filters: [...state.filters] });
      if (state.op === 'insert') {
        const arr = Array.isArray(state.payload) ? state.payload : [state.payload];
        const inserted: any[] = [];
        for (const rec of arr) {
          if (table === 'campaign_sends' && rec.is_test_send === false && ['sending', 'sent'].includes(rec.status)) {
            if (t.some((x) => x.campaign_id === rec.campaign_id && x.user_id === rec.user_id && x.is_test_send === false && ['sending', 'sent'].includes(x.status))) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "campaign_sends_unique_live_claim"' } };
            }
          }
          const row = { id: `row${db.nextId++}`, ...rec };
          t.push(row); inserted.push(row);
        }
        return { data: state.single ? inserted[0] : inserted, error: null };
      }
      if (state.op === 'update') {
        if (db.failUpdate?.(table, state.payload)) return { data: null, error: { message: 'simulated update failure' } };
        const hit = t.filter(matches);
        hit.forEach((r) => Object.assign(r, state.payload));
        return { data: hit, error: null };
      }
      const hit = t.filter(matches);
      if (state.head) return { data: null, count: hit.length, error: null };
      if (state.single || state.maybe) return { data: hit[0] ?? null, error: state.single && !hit[0] ? { message: 'no rows' } : null };
      return { data: hit, error: null };
    };
    const b: any = {
      select(_c?: string, opts?: any) { if (opts?.head) state.head = true; state.wantRows = true; return b; },
      insert(p: any) { state.op = 'insert'; state.payload = p; return b; },
      update(p: any) { state.op = 'update'; state.payload = p; return b; },
      delete() { state.op = 'delete'; return b; },
      eq(c: string, v: any) { state.filters.push([c, v]); return b; },
      in(c: string, v: any[]) { state.filters.push([c, v]); return b; },
      order() { return b; }, limit() { return b; },
      single() { state.single = true; return b; },
      maybeSingle() { state.maybe = true; return b; },
      then(res: any, rej: any) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } },
    };
    return b;
  }
}

export type FetchCall = { url: string; headers: Record<string, string>; body: any };

export function fakeResend(opts: { reject?: (to: string) => boolean; throwFor?: (to: string) => boolean } = {}) {
  const calls: FetchCall[] = [];
  let n = 1;
  const fn = (input: any, init?: any): Promise<Response> => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(input), headers: init?.headers || {}, body });
    const to = (body.to || [])[0];
    if (opts.throwFor?.(to)) return Promise.reject(new Error('network down'));
    if (opts.reject?.(to)) return Promise.resolve(new Response(JSON.stringify({ message: 'rejected' }), { status: 422 }));
    return Promise.resolve(new Response(JSON.stringify({ id: `msg_${n++}` }), { status: 200 }));
  };
  return { fetch: fn as typeof fetch, calls };
}

export function envOf(o: Record<string, string | undefined>) { return (k: string) => o[k]; }
