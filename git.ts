import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type GitObject = { type: string; data: Buffer };
const hex = (b: Buffer) => b.toString('hex');
const oidBytes = (s: string) => Buffer.from(s, 'hex');
function pkt(s: string | Buffer): Buffer {
  const b = Buffer.isBuffer(s) ? s : Buffer.from(s);
  return Buffer.concat([Buffer.from((b.length + 4).toString(16).padStart(4, '0')), b]);
}
const flush = () => Buffer.from('0000');
function sideband(data:Buffer):Buffer{const chunks:Buffer[]=[];for(let i=0;i<data.length;i+=65515)chunks.push(pkt(Buffer.concat([Buffer.from([1]),data.subarray(i,i+65515)])));return Buffer.concat(chunks);}
function parsePkts(b: Buffer): Buffer[] {
  const out: Buffer[] = []; let i = 0;
  while (i + 4 <= b.length) { const n = parseInt(b.subarray(i, i + 4).toString(), 16); i += 4; if (!n) break; if (n === 1 || n === 2) continue; if (n < 4 || i + n - 4 > b.length) break; out.push(b.subarray(i, i + n - 4)); i += n - 4; }
  return out;
}
function objectHash(type: string, data: Buffer): string { return hex(createHash('sha1').update(`${type} ${data.length}\0`).update(data).digest()); }
function encodeSize(n: number): Buffer { const a: number[] = []; do { let x = n & 127; n = Math.floor(n / 128); if (n) x |= 128; a.push(x); } while (n); return Buffer.from(a); }
function packEntry(type: string, data: Buffer): Buffer {
  const ids: Record<string, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };
  let n = data.length, first = ((ids[type] ?? 3) << 4) | (n & 15); n = Math.floor(n / 16);
  const h = [first | (n ? 128 : 0)]; while (n) { let x = n & 127; n = Math.floor(n / 128); if (n) x |= 128; h.push(x); }
  return Buffer.concat([Buffer.from(h), deflateSync(data)]);
}
function pack(objects: GitObject[]): Buffer {
  const head = Buffer.alloc(12); head.write('PACK'); head.writeUInt32BE(2, 4); head.writeUInt32BE(objects.length, 8);
  const body = Buffer.concat([head, ...objects.map(o => packEntry(o.type, o.data))]);
  return Buffer.concat([body, createHash('sha1').update(body).digest()]);
}

export class GitStore {
  objects = new Map<string, GitObject>();
  refs = new Map<string, string>();
  defaultBranch = 'main';
  put(type: string, data: Buffer): string {
    const copy = Buffer.from(data); const sha = objectHash(type, copy); this.objects.set(sha, { type, data: copy }); return sha;
  }
  resolve(ref: string): string | undefined {
    const full = ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
    if (this.refs.has(full)) return this.refs.get(full);
    return this.refs.get(ref) ?? (this.objects.has(ref) ? ref : undefined);
  }
  commit(sha: string): { tree: string; parents: string[]; message: string; author: { name: string; email: string; date: string } } {
    const id = this.resolve(sha) ?? sha, obj = this.objects.get(id); if (!obj || obj.type !== 'commit') throw new Error(`not a commit: ${sha}`);
    const text = obj.data.toString(), header = text.slice(0, text.indexOf('\n\n'));
    const tree = /^tree ([a-f0-9]{40})/m.exec(header)?.[1]; if (!tree) throw new Error('commit has no tree');
    const authorLine = /^author (.*) <(.*)> (\d+) ([+-]\d{4})$/m.exec(header);
    const stamp = authorLine ? new Date(Number(authorLine[3]) * 1000).toISOString() : '';
    return { tree, parents: [...header.matchAll(/^parent ([a-f0-9]{40})$/gm)].map(m => m[1]!), message: text.slice(text.indexOf('\n\n') + 2).replace(/\n$/, ''), author: { name: authorLine?.[1] ?? '', email: authorLine?.[2] ?? '', date: stamp } };
  }
  files(ref: string): Map<string, { sha: string; mode: string }> {
    const id = this.resolve(ref); if (!id) return new Map(); const tree = this.objects.get(this.commit(id).tree); if (!tree) return new Map();
    const out = new Map<string, { sha: string; mode: string }>(); let p = 0;
    while (p < tree.data.length) { const sp = tree.data.indexOf(32, p), nul = tree.data.indexOf(0, sp); if (sp < 0 || nul < 0 || nul + 21 > tree.data.length) break; const mode = tree.data.subarray(p, sp).toString(), name = tree.data.subarray(sp + 1, nul).toString(), sha = hex(tree.data.subarray(nul + 1, nul + 21)); out.set(name, { sha, mode }); p = nul + 21; }
    return out;
  }
  writeFiles(files: Map<string, { sha?: string; data?: Buffer; mode: string }>): string {
    const entries: Buffer[] = [];
    for (const [name, file] of [...files].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      const sha = file.sha ?? (file.data ? this.put('blob', file.data) : undefined); if (!sha) throw new Error(`missing content: ${name}`);
      entries.push(Buffer.from(`${file.mode} ${name}\0`), oidBytes(sha));
    }
    return this.put('tree', Buffer.concat(entries));
  }
  createCommit(tree: string, parents: string[], message: string, author = { name: 'Git Store', email: 'git@localhost', date: new Date(process.env.MAKEFUN_TRIAL_NOW || '2026-01-01T00:00:00Z') }): string {
    const date = author.date instanceof Date ? author.date : new Date(author.date);
    const epoch = Math.floor(date.getTime() / 1000); const who = `${author.name} <${author.email}> ${epoch} +0000`;
    const data = Buffer.from(`tree ${tree}\n${parents.map(p => `parent ${p}\n`).join('')}author ${who}\ncommitter ${who}\n\n${message}\n`);
    return this.put('commit', data);
  }
  isAncestor(a: string, b: string): boolean {
    const seen = new Set<string>(), todo = [b]; while (todo.length) { const id = todo.pop()!; if (id === a) return true; if (seen.has(id)) continue; seen.add(id); try { todo.push(...this.commit(id).parents); } catch {} } return false;
  }
}

export function handleGit(store: GitStore, req: IncomingMessage, res: ServerResponse, body: Buffer, url: URL): void {
  const service = url.searchParams.get('service'); const v2 = req.headers['git-protocol'] === 'version=2';
  const respond = (status: number, type: string, data: Buffer) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache', 'content-length': data.length }); res.end(data); };
  const refs = [...store.refs].sort(([a], [b]) => a.localeCompare(b));

  if (url.pathname.endsWith('/info/refs') && req.method === 'GET') {
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') { respond(403, 'text/plain', Buffer.from('unsupported service')); return; }
    let data: Buffer;
    if (v2 && service === 'git-upload-pack') data = Buffer.concat([pkt('version 2\n'), pkt('agent=git-native\n'), pkt('ls-refs=unborn\n'), pkt('fetch=shallow wait-for-done\n'), pkt('server-option\n'), pkt('object-format=sha1\n'), flush()]);
    else {
      const caps = service === 'git-receive-pack' ? 'report-status side-band-64k delete-refs' : 'multi_ack_detailed side-band-64k ofs-delta shallow filter';
      const lines: Buffer[] = [pkt(`# service=${service}\n`), flush()];
      if (refs.length) refs.forEach(([name, sha], i) => lines.push(pkt(`${sha} ${name}${i === 0 ? `\0${caps} agent=git-native` : ''}\n`)));
      else lines.push(pkt(`${'0'.repeat(40)} capabilities^{}\0${caps}\n`));
      lines.push(flush()); data = Buffer.concat(lines);
    }
    respond(200, `application/x-${service}-advertisement`, data); return;
  }
  if (url.pathname.endsWith('/git-upload-pack') && req.method === 'POST') {
    const packets = parsePkts(body), lines = packets.map(p => p.toString().trim());
    if (v2) {
      const command = lines[0];
      if (command === 'command=ls-refs') {
        const prefix = lines.filter(x => x.startsWith('ref-prefix ')).map(x => x.slice(11)); const sym = lines.some(x => x === 'symrefs');
        const listed: Buffer[] = [];
        const head = store.refs.get(`refs/heads/${store.defaultBranch}`);
        if (head && (!prefix.length || prefix.some(p => 'HEAD'.startsWith(p)))) listed.push(pkt(`${head} HEAD${sym ? ` symref-target:refs/heads/${store.defaultBranch}` : ''}\n`));
        for (const [name, sha] of refs) if (!prefix.length || prefix.some(p => name.startsWith(p))) listed.push(pkt(`${sha} ${name}${sym && name === `refs/heads/${store.defaultBranch}` ? ` symref-target:HEAD` : ''}\n`));
        listed.push(flush()); respond(200, 'application/x-git-upload-pack-result', Buffer.concat(listed)); return;
      }
      const wants = lines.filter(x => x.startsWith('want ')).map(x => x.slice(5));
      const objs = collect(store, wants, lines); const packData = pack(objs);
      respond(200, 'application/x-git-upload-pack-result', Buffer.concat([pkt('acknowledgments\n'), pkt('NAK\n'), flush(), pkt('shallow-info\n'), flush(), pkt('packfile\n'), sideband(packData), flush()])); return;
    }
    const wants = lines.filter(x => x.startsWith('want ')).map(x => x.slice(5));
    if (!wants.length) { respond(200, 'application/x-git-upload-pack-result', flush()); return; }
    const objs = collect(store, wants, lines), p = pack(objs);
    respond(200, 'application/x-git-upload-pack-result', Buffer.concat([sideband(p), flush()])); return;
  }
  if (url.pathname.endsWith('/git-receive-pack') && req.method === 'POST') {
    const packets = parsePkts(body); const commands: Array<{ old: string; next: string; ref: string }> = []; let packOffset = 0;
    for (const p of packets) { const s = p.toString(); if (/^[a-f0-9]{40} [a-f0-9]{40} /.test(s)) { const first = s.split('\0')[0]!.trim().split(' '); commands.push({ old: first[0]!, next: first[1]!, ref: first[2]! }); } }
    packOffset = body.indexOf(Buffer.from('PACK'));
    let unpackOk = true;
    if (packOffset >= 0) { try { ingestPack(store, body.subarray(packOffset)); } catch { unpackOk = false; } }
    const results: Buffer[] = [pkt('unpack ' + (unpackOk ? 'ok' : 'error') + '\n')];
    for (const c of commands) {
      const old = store.refs.get(c.ref); let reason = '';
      if (c.next === '0'.repeat(40)) { if (old !== c.old) reason = 'stale info'; else store.refs.delete(c.ref); }
      else if (!store.objects.has(c.next)) reason = 'missing object';
      else if (old && old !== c.old) reason = 'stale info';
      else if (old && !store.isAncestor(old, c.next)) reason = 'non-fast-forward';
      else store.refs.set(c.ref, c.next);
      results.push(pkt(reason ? `ng ${c.ref} ${reason}\n` : `ok ${c.ref}\n`));
    }
    results.push(flush()); const report = Buffer.concat(results);
    respond(200, 'application/x-git-receive-pack-result', Buffer.concat([pkt(Buffer.concat([Buffer.from([1]), report])), flush()])); return;
  }
  respond(404, 'text/plain', Buffer.from('not found'));
}
function collect(store: GitStore, wants: string[], lines: string[]): GitObject[] {
  const shallow = lines.some(x => x.startsWith('deepen ')); const have = new Set(lines.filter(x => x.startsWith('have ')).map(x => x.slice(5)));
  const seen = new Set<string>(), out: GitObject[] = [], todo = [...wants];
  while (todo.length) { const sha = todo.pop()!; if (seen.has(sha) || have.has(sha)) continue; seen.add(sha); const obj = store.objects.get(sha); if (!obj) continue; out.push(obj); if (obj.type === 'commit') { const c = store.commit(sha); if (!shallow) todo.push(c.tree, ...c.parents); else todo.push(c.tree); } else if (obj.type === 'tree') { let p = 0; while (p < obj.data.length) { const sp = obj.data.indexOf(32,p), nul = obj.data.indexOf(0,sp); if (sp < 0 || nul < 0 || nul + 21 > obj.data.length) break; todo.push(hex(obj.data.subarray(nul+1,nul+21))); p=nul+21; } } }
  return out;
}
function ingestPack(store: GitStore, data: Buffer): void {
  if (data.length < 32 || data.toString('ascii',0,4) !== 'PACK') throw new Error('bad pack');
  const end = data.length - 20; if (!createHash('sha1').update(data.subarray(0,end)).digest().equals(data.subarray(end))) throw new Error('bad pack checksum');
  const count = data.readUInt32BE(8), types: Record<number,string> = {1:'commit',2:'tree',3:'blob',4:'tag'}; let p=12;
  const byOffset = new Map<number, GitObject>(); const pending: Array<{type:number; data:Buffer; base?:string; offset?:number}> = [];
  for (let i=0;i<count;i++) {
    const start=p; let c=data[p++]!, type=(c>>4)&7, size=c&15, shift=4;
    while(c&128){c=data[p++]!;size+=(c&127)*2**shift;shift+=7;}
    let base: string|undefined, offset: number|undefined;
    if(type===6){let x=data[p++]!, distance=x&127; while(x&128){x=data[p++]!;distance=((distance+1)<<7)|(x&127);} offset=start-distance;}
    if(type===7){base=hex(data.subarray(p,p+20));p+=20;}
    const z=inflateSync(data.subarray(p,end),{info:true}); p+=z.engine.bytesWritten; const raw=z.buffer;
    if(type<6){if(raw.length!==size) throw new Error('bad object size'); const obj={type:types[type]!,data:raw}; byOffset.set(start,obj); store.put(obj.type,raw);}
    else pending.push({type,data:raw,base,offset});
  }
  const varint=(buf:Buffer,state:{p:number})=>{let n=0,shift=0,b:number;do{b=buf[state.p++]!;n+=(b&127)*2**shift;shift+=7;}while(b&128);return n;};
  for(let pass=0;pending.length&&pass<=count;pass++) for(let i=pending.length-1;i>=0;i--){const d=pending[i]!,baseObj=d.base?store.objects.get(d.base):byOffset.get(d.offset!);if(!baseObj)continue;const st={p:0};varint(d.data,st);const resultSize=varint(d.data,st),chunks:Buffer[]=[];let produced=0;
    while(st.p<d.data.length){const op=d.data[st.p++]!;if(op&128){let off=0,len=0;for(let j=0;j<4;j++)if(op&(1<<j))off|=d.data[st.p++]!<<(j*8);for(let j=0;j<3;j++)if(op&(16<<j))len|=d.data[st.p++]!<<(j*8);if(!len)len=0x10000;chunks.push(baseObj.data.subarray(off,off+len));produced+=len;}else if(op){chunks.push(d.data.subarray(st.p,st.p+op));st.p+=op;produced+=op;}else throw new Error('invalid delta opcode');}
    const result=Buffer.concat(chunks);if(result.length!==resultSize||produced!==resultSize)throw new Error('invalid delta result');const obj={type:baseObj.type,data:result};if(d.offset!==undefined)byOffset.set(d.offset,obj);store.put(obj.type,result);pending.splice(i,1);
  }
  if(pending.length)throw new Error('unresolved pack delta');
}
