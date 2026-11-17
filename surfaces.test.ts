import assert from 'node:assert/strict';
import { graphql } from './graphql.ts';
import { mcp } from './mcp.ts';

const repo: any = { id: 7, node_id: 'UmVwb3NpdG9yeTo3', name: 'demo', full_name: 'octo/demo', owner: { login: 'octo' }, description: null, default_branch: 'main', private: false, has_issues: true, git: { refs: new Map() }, issues: new Map(), pulls: new Map(), labels: new Map() };
const store: any = {
  owner: 'octo', user: { login: 'octo' }, repos: new Map([['octo/demo', repo]]),
  repo(owner: string, name: string) { const r = this.repos.get(`${owner}/${name}`); if (!r) throw Object.assign(new Error('Not Found'), { status: 404 }); return r; },
  node(id: string) { return id === repo.node_id ? repo : null; },
  request(method: string, path: string, body: any = {}) {
    if (path.endsWith('/issues') && method === 'POST') { const number = repo.issues.size + 1; const x = { id: number + 20, node_id: Buffer.from(`Issue:${number + 20}`).toString('base64'), number, title: body.title, body: body.body ?? null, state: 'open', repository: repo }; repo.issues.set(number, x); return { status: 201, body: x }; }
    if (path.endsWith('/pulls') && method === 'POST') { const number = repo.pulls.size + 1; const x = { id: number + 50, node_id: Buffer.from(`PullRequest:${number + 50}`).toString('base64'), number, title: body.title, body: null, state: 'open', merged: false, head: { ref: body.head }, base: { ref: body.base }, repository: repo }; repo.pulls.set(number, x); return { status: 201, body: x }; }
    if (path.endsWith('/merge')) return { status: 200, body: { merged: true, sha: 'abc', message: 'merged' } };
    return { status: 404, body: { message: 'Not Found' } };
  }
};

const q = (query: string, variables = {}) => graphql(store, { query, variables });
assert.equal(q('query($o:String!,$n:String!){ repository(owner:$o,name:$n){ alias:name issues(first:2){nodes{number title}} }}', { o: 'octo', n: 'demo' }).data.repository.alias, 'demo');
assert.ok(q('{ __type(name:"Repository"){ fields { name } } }').data.__type.fields.some((x: any) => x.name === 'pullRequest'));
assert.ok(q('{ repository(owner:"missing",name:"x"){name} }').data.repository === null);
const bad = q('{ repository(owner:"octo",name:"demo"){ definitelyUnknown } }');
assert.ok(bad.errors?.length);
const created = q('mutation($input:CreateIssueInput!){ createIssue(input:$input){issue{number title}} }', { input: { repositoryId: repo.node_id, title: 'from gql', body: 'b' } });
assert.equal(created.data.createIssue.issue.title, 'from gql');
const listed = mcp(store, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
assert.ok(listed.body.result.tools.length >= 6);
const call = mcp(store, { jsonrpc: '2.0', id: 'x', method: 'tools/call', params: { name: 'create_issue', arguments: { owner: 'octo', repo: 'demo', title: 'from mcp' } } });
assert.equal(call.body.id, 'x');
assert.equal(repo.issues.get(2).title, 'from mcp');
