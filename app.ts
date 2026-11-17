import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import {ForgeStore} from './store.ts';
import {graphql} from './graphql.ts';
import {mcp} from './mcp.ts';
import {handleGit} from './git.ts';
const TYPE='application/json; charset=utf-8';
function send(res:ServerResponse,status:number,body:any,headers:Record<string,string>={}){const text=body===null?'':`${JSON.stringify(body)}\n`;res.writeHead(status,{'content-type':TYPE,'content-length':Buffer.byteLength(text),...headers});res.end(text);}
async function read(req:IncomingMessage):Promise<Buffer>{const parts:Buffer[]=[];for await(const c of req)parts.push(Buffer.isBuffer(c)?c:Buffer.from(c));return Buffer.concat(parts);}
export function createApp():Server{const store=new ForgeStore(),token=process.env.MAKEFUN_SHOP_TOKEN||'';return createServer(async(req,res)=>{const u=new URL(req.url||'/', 'http://forge'),method=req.method||'GET';if(method==='GET'&&u.pathname==='/healthz'){send(res,200,{ok:true});return;}let raw:Buffer;try{raw=await read(req);}catch{send(res,400,{message:'Bad Request'});return;}
if(u.pathname==='/mcp'){if(req.headers.authorization!==`Bearer ${token}`){send(res,401,{message:'Requires authentication'});return;}let b:any;try{b=raw.length?JSON.parse(raw.toString()):null;}catch{send(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}const out=mcp(store,b);send(res,out.status,out.body,out.headers as any);return;}
if(u.pathname==='/api/graphql'){if(req.headers.authorization!==`Bearer ${token}`){send(res,401,{message:'Requires authentication'});return;}let b:any;try{b=JSON.parse(raw.toString());}catch{send(res,400,{message:'Malformed JSON'});return;}send(res,200,graphql(store,b));return;}
if(u.pathname.startsWith('/api/v3')){const rid=`FORGE${String(store.requestSequence++).padStart(8,'0')}`;if(req.headers.authorization!==`Bearer ${token}`){send(res,401,{message:'Requires authentication'},{'x-github-request-id':rid});return;}let b:any={};if(raw.length){try{b=JSON.parse(raw.toString());if(!b||typeof b!=='object'||Array.isArray(b))throw Error();}catch{send(res,400,{message:'Malformed JSON'},{'x-github-request-id':rid});return;}}const out=store.request(method,u.pathname,b,u.searchParams);send(res,out.status,out.body,{'x-github-request-id':rid,...out.headers});return;}
const m=/^\/([^/]+)\/([^/]+)\.git\/(.+)$/.exec(u.pathname);if(m){const r=store.repos.get(`${m[1]}/${m[2]}`);if(!r){send(res,404,{message:'Not Found'});return;}handleGit(r.git,req,res,raw,u);return;}send(res,404,{message:'Not Found'});});}
