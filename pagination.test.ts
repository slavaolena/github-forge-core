import test from 'node:test';
import assert from 'node:assert/strict';
import {ForgeStore} from './store.ts';
test('pagination serves three stable pages of 30 user repositories and follows next link',()=>{const s=new ForgeStore();for(let i=0;i<30;i++)assert.equal(s.request('POST','/api/v3/user/repos',{name:`seed-${i}`}).status,201);const seen:string[]=[];let q=new URLSearchParams({per_page:'10'});for(let i=0;i<4;i++){const x=s.request('GET','/api/v3/user/repos',{},q);seen.push(...x.body.map((r:any)=>r.name));const link=x.headers.link;if(!link)break;const url=/^<([^>]+)>/.exec(link)?.[1];assert.ok(url);q=new URLSearchParams(url!.split('?')[1]);}assert.equal(seen.length,30);assert.equal(new Set(seen).size,30);});
