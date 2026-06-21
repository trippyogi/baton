'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const http=require('http');const {spawn}=require('child_process');
const repo=process.env.BATON_REPO || process.cwd();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'baton-adversarial-'));
const port=7300+Math.floor(Math.random()*200); const fakePort=7500+Math.floor(Math.random()*200); const BASE=`http://127.0.0.1:${port}`;
const received=[];
const fake=http.createServer(async(req,res)=>{let data='';for await(const c of req)data+=c;let body={};try{body=JSON.parse(data)}catch{};received.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,status:'accepted',external_run_id:`ext_${received.length}`}));});
function listen(s,p){return new Promise(r=>s.listen(p,'127.0.0.1',r))}
async function req(p,{method='GET',body,headers={}}={}){const r=await fetch(BASE+p,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const text=await r.text();let json;try{json=JSON.parse(text)}catch{json=text};return {status:r.status,ok:r.ok,json,text};}
async function wait(){for(let i=0;i<100;i++){try{const r=await req('/api/health');if(r.ok)return}catch{};await new Promise(r=>setTimeout(r,50))}throw new Error('no health')}
(async()=>{
 await listen(fake,fakePort);
 const child=spawn(process.execPath,['server/index.js'],{cwd:repo,env:{...process.env,VMC_PORT:String(port),BATON_DB_PATH:path.join(temp,'db.sqlite'),REDIS_URL:'redis://127.0.0.1:0',SPECTRE_WEBHOOK_URL:`http://127.0.0.1:${fakePort}/baton/dispatch`,SPECTRE_DISPATCH_TOKEN:'x',BATON_CALLBACK_TOKEN:'cb',BATON_PUBLIC_BASE_URL:BASE,NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',d=>err+=d);await wait();
 const out={};
 // duplicate dispatch
 const cmd=(await req('/api/flow/command',{method:'POST',body:{input:'delegate Spectre duplicate dispatch test'}})).json;
 let flow=(await req('/api/flow?limit=50')).json;const touch=flow.next_touches.find(t=>t.task_id===cmd.created.task_id);
 const d1=await req(`/api/touches/${touch.id}/action`,{method:'PATCH',body:{action:'assign'}});
 const d2=await req(`/api/touches/${touch.id}/action`,{method:'PATCH',body:{action:'assign'}});
 const runs=(await req('/api/runs?limit=100')).json.runs.filter(r=>r.touch_id===touch.id);
 out.duplicate_dispatch={first:d1.json.run?.id,second:d2.json.run?.id,webhooks:received.filter(x=>x.touch_id===touch.id).length,runs:runs.map(r=>({id:r.id,status:r.status}))};
 // structured review packet loss
 const task=(await req('/api/tasks',{method:'POST',body:{title:'Structured packet test',status:'in_progress',owner:'spectre'}})).json;
 const packetResp=await req('/api/review-packets',{method:'POST',body:{task_id:task.id,goal:'Goal',summary:'Summary',recommended_next_action:'Review',evidence:['e'],risks:[],open_questions:[],confidence_score:.8,quality_score:.8,sections:[{type:'bullets',title:'Findings',items:['A']}],artifacts:[{type:'markdown',name:'a.md',url:'http://example.test/a'}]}});
 const packet=packetResp.json.packet;out.structured_packet={sections:packet.sections,artifacts:packet.artifacts};
 // evaluator envelope omission
 const badTask=(await req('/api/tasks',{method:'POST',body:{title:'Evaluator source test',description:'base task description',status:'in_progress',owner:'spectre'}})).json;
 const bad=(await req('/api/review-packets',{method:'POST',body:{task_id:badTask.id,goal:'Missing summary evaluator goal',summary:'',recommended_next_action:'Fix it',evidence:[],confidence_score:.5,quality_score:.4}})).json;
 flow=(await req('/api/flow?limit=100')).json;const refine=flow.next_touches.find(t=>t.id===bad.refine_touch_id);
 const evalDispatch=await req(`/api/touches/${refine.id}/action`,{method:'PATCH',body:{action:'send_to_evaluator'}});
 out.evaluator={agent_id:evalDispatch.json.run?.agent_id,dispatch_status:evalDispatch.json.dispatch_status,payload:evalDispatch.json.run?.dispatch_payload,source_packet_id:refine.review_packet_id};
 // feedback loss
 const waitTask=(await req('/api/tasks',{method:'POST',body:{title:'Feedback propagation test',description:'initial description',status:'waiting',owner:'spectre'}})).json;
 flow=(await req('/api/flow?limit=100')).json;const blocker=flow.next_touches.find(t=>t.task_id===waitTask.id&&t.type==='blocker');
 await req(`/api/touches/${blocker.id}/action`,{method:'PATCH',body:{action:'answer',feedback:'USE THIS CRITICAL HUMAN ANSWER'}});
 // make spectre idle so candidate match possible
 await req('/api/agents/spectre',{method:'PATCH',body:{status:'idle',current_task_id:null,current_run_id:null}});
 flow=(await req('/api/flow?limit=100')).json;const next=flow.next_touches.find(t=>t.task_id===waitTask.id);
 const fbDispatch=await req(`/api/touches/${next.id}/action`,{method:'PATCH',body:{action:next.primary_action}});
 const fbEnvelope=received.filter(x=>x.task_id===waitTask.id).at(-1);
 out.feedback={next_type:next.type,envelope:fbEnvelope,contains_feedback:JSON.stringify(fbEnvelope||{}).includes('USE THIS CRITICAL HUMAN ANSWER')};
 // airspace can lie from manual in_progress task
 const before=(await req('/api/flow')).json.airspace.running;
 await req('/api/tasks',{method:'POST',body:{title:'Manual fake airborne',status:'in_progress'}});
 const after=(await req('/api/flow')).json.airspace.running;
 out.airspace={before,after,delta:after-before};
 // late ACK regression after completion on d1 run: submit valid packet, accept then ack
 const rp=(await req('/api/review-packets',{method:'POST',body:{run_id:d1.json.run.id,task_id:cmd.created.task_id,agent_id:'spectre',goal:'finish',summary:'done',recommended_next_action:'accept',evidence:['done'],confidence_score:.9,quality_score:.9}})).json;
 flow=(await req('/api/flow?limit=100')).json;const rt=flow.next_touches.find(t=>t.review_packet_id===rp.packet.id);
 await req(`/api/touches/${rt.id}/action`,{method:'PATCH',body:{action:'accept'}});
 const completed=(await req(`/api/runs/${d1.json.run.id}`)).json.status;
 const late=await req(`/api/runs/${d1.json.run.id}/ack`,{method:'POST',headers:{authorization:'Bearer cb'},body:{ok:true,status:'accepted',external_run_id:'late'}});
 out.late_ack={before:completed,after:late.json.status};
 console.log(JSON.stringify(out,null,2));
 child.kill('SIGTERM');fake.close();
 setTimeout(()=>fs.rmSync(temp,{recursive:true,force:true}),250);
})().catch(e=>{console.error(e);process.exit(1)});
