// Real rc.3 Host, copied distribution code and synthetic QQ transport only.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const project=path.resolve(__dirname,'..'),install=require('./installation.cjs').install,toolkit=path.resolve(process.env.DSH_QQTK_PROJECT||project+'/../harness-qq-toolkit');
const run=args=>cp.execFileSync(process.execPath,args,{stdio:'pipe',windowsHide:true});
run([project+'/scripts/stage-interaction.cjs']);const transport=JSON.parse(fs.readFileSync(project+'/test-data/interaction-run.json'));
run([project+'/scripts/stage-inspector.cjs','--extras']);const probe=JSON.parse(fs.readFileSync(project+'/test-data/inspector-run.json'));
const dir=probe.home+'/profiles/inspector',yaml=require(require.resolve('js-yaml',{paths:[install+'/data/profiles/desktop']})),dialect=require('./deployment-plan.cjs').entryYaml(yaml),rows=dialect.load(fs.readFileSync(dir+'/cordis.patch.yml','utf8'));
const inserted=rows.find(r=>r.insert).insert,entry=inserted.find(r=>r.id==='inspector-probe');
entry.name=pathToFileURL(project+'/tests/communication-host.mjs').href;entry.config.qqFixture=transport.home+'/qq-fixture';entry.config.toolkit=toolkit;
const generic=process.argv.includes('--generic');entry.config.generic=generic;
if(generic){for(let i=inserted.length-1;i>=0;i--)if(inserted[i]!==entry)inserted.splice(i,1);const manifest=JSON.parse(fs.readFileSync(dir+'/package.json'));manifest.dsh.profile.bundles=manifest.dsh.profile.bundles.filter(b=>b!=='fixture-extras');fs.writeFileSync(dir+'/package.json',JSON.stringify(manifest));}
else inserted.find(r=>r.id==='preset-qq-character').config.plugins.push({id:'communication-interaction',name:pathToFileURL(project+'/packages/interaction-policy/index.mjs').href,isolate:{interactionPolicy:true},config:{enabled:true,hangOnMs:30000}});
inserted.unshift({id:'agent-io',name:'dsh-agent-io',config:{}},{id:'conversation-manager',name:pathToFileURL(toolkit+'/plugin-sources/dsh-conversation-manager/index.mjs').href,config:{stateFile:probe.home+'/conversations.json'}});
if(!generic)inserted.find(r=>r.id==='memory-core').config.autoCapture=false;
fs.cpSync(transport.home+'/profiles/interaction/node_modules/dsh-agent-io',dir+'/node_modules/dsh-agent-io',{recursive:true,dereference:true});
const manifest=JSON.parse(fs.readFileSync(dir+'/package.json'));manifest.dependencies['dsh-agent-io']=JSON.parse(fs.readFileSync(dir+'/node_modules/dsh-agent-io/package.json')).version;fs.writeFileSync(dir+'/package.json',JSON.stringify(manifest));
const bootstrap=entry.config.qqFixture+'/dist/gateway/bootstrap.js';let source=fs.readFileSync(bootstrap,'utf8');
const original="import { QQBot, MediaFileType } from '@tencent-connect/qqbot-nodejs';";
if(!source.includes(original))throw Error('Reviewed Gateway import changed; revalidate synthetic transport');
source=source.replace(original,"import { MediaFileType } from '@tencent-connect/qqbot-nodejs';\nimport {QQBot} from './synthetic-bot.mjs';");fs.writeFileSync(bootstrap,source);
fs.writeFileSync(entry.config.qqFixture+'/dist/gateway/synthetic-bot.mjs',`export const instances=[];
export class QQBot{
 constructor(config){this.config=config;this.handlers=new Map();this.middlewares=[];this.sent=[];this.creds={appId:config.appId,clientSecret:'synthetic'};instances.push(this);}
 use(fn){this.middlewares.push(async(ctx,next)=>{try{return await fn(ctx,next);}catch(error){ctx.testErrors.push(error.stack);throw error;}});}
 on(name,fn){const list=this.handlers.get(name)??[];list.push(fn);this.handlers.set(name,list);}
 off(name,fn){this.handlers.set(name,(this.handlers.get(name)??[]).filter(f=>f!==fn));}
 async start(){for(const fn of this.handlers.get('ready')??[])await fn();}
 stop(){this.stopped=true;}
 async send(opts){this.sent.push(opts.markdown?.content??opts.content??'');return {id:'synthetic-'+this.sent.length};}
 async sendText(target,text){throw Error('Direct sendText bypassed I/O');}
 async sendMarkdown(target,text,options){if(!new Error().stack.includes('reply-target.js'))throw Error('Direct sendMarkdown bypassed I/O');this.sent.push(text);return {id:'synthetic-'+this.sent.length};}
 async sendTyping(){return {};}
 async acknowledgeInteraction(){return {};}
 async push(message){const target={scope:'c2c',targetId:message.senderId,msgId:message.messageId};const ctx={message:{...message,replyTarget:target},replyTarget:target,bot:this,state:{},testErrors:[],log:{debug(){},info(){},warn(){},error(){}},stop(){this.stoppedInput=true;},abort(){}};let i=0;const next=async()=>{if(ctx.stoppedInput)return;const mw=this.middlewares[i++];if(mw)return mw(ctx,next);for(const fn of this.handlers.get('message')??[])await fn(ctx);};await next();return ctx;}
}
`);
fs.writeFileSync(dir+'/cordis.patch.yml',dialect.dump(rows,{noRefs:true}));
if(fs.existsSync(probe.home+'/.env')||fs.existsSync(probe.home+'/.credentials.yaml'))throw Error('Communication fixture must have no credentials');
fs.writeFileSync(project+'/test-data/communication-run.json',JSON.stringify({...probe,transportHome:transport.home}));console.log(JSON.stringify({home:probe.home,runId:probe.runId,qqNetwork:false,credentialsCopied:false}));
