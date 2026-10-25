import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const project=new URL('../',import.meta.url).href,root=process.env.DSH_INSTALL_ROOT;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.startsWith(project)){
  if(specifier.startsWith('@deepseek-ai/'))return next(specifier,{...context,parentURL:pathToFileURL(root+'/resources/app.asar/dsh/package.json').href});
  if(context.parentURL.includes('/qq-fixture/')&&!specifier.startsWith('.')&&!specifier.startsWith('node:'))return next(specifier,{...context,parentURL:pathToFileURL(root+'/data/profiles/desktop/node_modules/@tencent-connect/dsh-qqbot/package.json').href});
 }
 return next(specifier,context);
}});
