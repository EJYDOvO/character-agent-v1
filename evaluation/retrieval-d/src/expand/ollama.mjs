// Minimal client for a *local* Ollama server (default http://127.0.0.1:11434). Used only to produce the
// cached model expansions under dataset/expansions/. Nothing is sent to a remote service.
const host=process.env.OLLAMA_HOST_URL??'http://127.0.0.1:11434';
export const OPTIONS={temperature:0,seed:7,top_p:1,num_predict:220,num_ctx:4096};

export async function modelInfo(model){
 const tags=await (await fetch(host+'/api/tags')).json(),entry=tags.models?.find(m=>m.name===model||m.model===model);
 if(!entry)throw Error(`Ollama model ${model} is not available locally`);
 return {model:entry.name,digest:entry.digest,parameterSize:entry.details?.parameter_size,quantization:entry.details?.quantization_level,family:entry.details?.family,ollama:(await (await fetch(host+'/api/version')).json()).version};
}

export async function chatJson(model,system,user,schema){
 const started=performance.now();
 const response=await fetch(host+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:false,format:schema,options:OPTIONS,keep_alive:'10m',messages:[{role:'system',content:system},{role:'user',content:user}]})});
 if(!response.ok)throw Error('Ollama HTTP '+response.status+': '+(await response.text()).slice(0,200));
 const body=await response.json();
 return {value:JSON.parse(body.message.content),stats:{wallMs:Math.round(performance.now()-started),promptTokens:body.prompt_eval_count??null,outputTokens:body.eval_count??null,evalMs:body.eval_duration?Math.round(body.eval_duration/1e6):null}};
}
