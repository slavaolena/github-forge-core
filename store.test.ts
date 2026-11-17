import test from 'node:test';
import assert from 'node:assert/strict';
import {ForgeStore} from './store.ts';
test('public instance identity and nested REST content share Git objects',()=>{
 const s=new ForgeStore();assert.equal(s.owner,'adaiversen');
 assert.equal(s.request('GET','/api/v3/user').body.login,s.owner);
 const r=s.request('POST','/api/v3/user/repos',{name:'demo'});assert.equal(r.status,201);
 const p=`/api/v3/repos/${s.owner}/demo`;
 const put=s.request('PUT',p+'/contents/src/deep/file.txt',{message:'first',content:Buffer.from('one').toString('base64')});assert.equal(put.status,201);
 const content=s.request('GET',p+'/contents/src/deep/file.txt');assert.equal(content.body.content,Buffer.from('one').toString('base64'));
 const repo=s.repo(s.owner,'demo');assert.equal(repo.git.objects.get(content.body.sha).data.toString(),'one');
 assert.equal(s.request('GET',p+'/contents/src').body[0].type,'dir');
 assert.equal(s.request('GET',`/api/v3/repos/stranger/demo`).status,404);
});
