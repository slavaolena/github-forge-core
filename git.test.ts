import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { GitStore, handleGit } from './git.ts';

test('native object store hashes objects, round-trips tree/commit and ancestry', () => {
  const store = new GitStore();
  const tree = store.writeFiles(new Map([['hello.txt', { data: Buffer.from('hello\n'), mode: '100644' }]]));
  const first = store.createCommit(tree, [], 'initial', { name: 'A', email: 'a@b', date: new Date('2024-01-01T00:00:00Z') });
  const second = store.createCommit(tree, [first], 'second', { name: 'A', email: 'a@b', date: new Date('2024-01-02T00:00:00Z') });
  store.refs.set('refs/heads/main', second);
  assert.equal(store.resolve('main'), second);
  assert.equal(store.commit(second).parents[0], first);
  assert.equal(store.files('main').get('hello.txt')?.mode, '100644');
  assert.equal(store.isAncestor(first, second), true);
  assert.equal(store.isAncestor(second, first), false);
});

test('smart HTTP advertises v2 ls-refs and receive-pack v0', async () => {
  const store = new GitStore();
  const tree = store.writeFiles(new Map());
  const tip = store.createCommit(tree, [], 'initial');
  store.refs.set('refs/heads/main', tip);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => handleGit(store, req, res, Buffer.concat(chunks), new URL(req.url!, 'http://local')));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/owner/repo.git`;
    const v2 = await fetch(`${base}/info/refs?service=git-upload-pack`, { headers: { 'git-protocol': 'version=2' } });
    const text = Buffer.from(await v2.arrayBuffer()).toString();
    assert.equal(v2.status, 200);
    assert.match(text, /version 2/);
    assert.match(text, /ls-refs/);
    const push = await fetch(`${base}/info/refs?service=git-receive-pack`);
    const pushText = Buffer.from(await push.arrayBuffer()).toString();
    assert.match(pushText, /# service=git-receive-pack/);
    assert.match(pushText, /report-status.*side-band-64k.*delete-refs/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
