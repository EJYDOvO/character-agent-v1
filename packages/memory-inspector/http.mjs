const local=address=>address==='::1'||address==='127.0.0.1'||address==='::ffff:127.0.0.1';
export function handler({connection,origin,dispatch,assets,isClosed=()=>false}){
 return async(req,res)=>{
  const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(typeof body==='string'?body:JSON.stringify(body));};
  if(isClosed())return send(503,{error:'Inspector unavailable'});
  if(!local(req.socket.remoteAddress)||req.headers.host!==new URL(origin()).host)return send(403,{error:'Local access required'});
  const admitted=connection.admit(req);
  if('rejection' in admitted)return send(admitted.rejection,{error:'Open the authenticated DSH Web page first'});
  if(admitted.peer?.principal?.kind!=='owner')return send(403,{error:'Host owner required'});
  const url=new URL(req.url,origin());
  if(req.method==='GET'&&assets.has(url.pathname)){const a=assets.get(url.pathname);return send(200,a.body,a.type);}
  if(req.method!=='POST'||url.pathname!=='/memory-inspector/api')return send(404,{error:'Not found'});
  // Desktop's owned dsh-app:// relay removes Origin and Sec-Fetch-Site and
  // supplies its private Host cookie. Native admission above remains required.
  // Never accept Origin:null, a foreign origin or an untrusted browser site.
  const desktopRelay=req.headers.origin===undefined&&req.headers['sec-fetch-site']===undefined;
  if((req.headers.origin!==origin()&&!desktopRelay)||req.headers['content-type']?.split(';')[0]!=='application/json')return send(403,{error:'Same-origin JSON required'});
  let size=0,chunks=[],rpcId;const timer=setTimeout(()=>req.destroy(),10000);
  try{
   for await(const chunk of req){size+=chunk.length;if(size>16384)return send(413,{error:'Request too large'});chunks.push(chunk);}
   if(isClosed())return send(503,{error:'Inspector unavailable'});
   // Revalidate the Host peer after reading an asynchronous body.
   const fresh=connection.admit(req);if('rejection' in fresh||fresh.peer?.principal?.kind!=='owner')return send(401,{error:'Authentication expired'});
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   // Native Connection RPC transport also works in the Desktop renderer.
   // Keep the bounded HTTP carrier so authentication is rechecked after body IO.
   let request=body;
   if(body?.type==='client-request'){
    if(body.method!=='api'||typeof body.rpcId!=='string'||body.rpcId.length>128||!body.rpcId.length)throw Error('Invalid envelope');
    rpcId=body.rpcId;request=body.payload;
   }
   const value=dispatch(request);
   return send(200,rpcId?{type:'server-response',rpcId,result:{ok:true,value}}:value);
  }catch(e){const status=/Revision conflict/.test(e.message)?409:/Unauthorized|read only/.test(e.message)?403:400;
   const message=status===409?'Revision conflict; reload before editing':'Request rejected by memory policy';
   return rpcId?send(200,{type:'server-response',rpcId,result:{ok:false,error:{code:'memory/'+status,message}}}):send(status,{error:message});}
  finally{clearTimeout(timer);}
 };
}
