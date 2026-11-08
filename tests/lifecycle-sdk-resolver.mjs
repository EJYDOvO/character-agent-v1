import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {dirname,resolve as resolvePath} from 'node:path';
import {existsSync} from 'node:fs';
const project=new URL('../',import.meta.url).href,root=process.env.DSH_INSTALL_ROOT,runtime=process.env.DSH_CHARACTER_HOST_ROOT||root;
// Code of this project, and fixtures staged into isolated test Homes. Homes are
// siblings under one root outside the git work tree (scripts/test-home.cjs); a
// marked DSH_HOME names that root, so fixtures staged into another Home of the
// same run (e.g. the interaction transport used by roles) are covered too.
const marked=process.env.DSH_HOME&&existsSync(resolvePath(process.env.DSH_HOME,'.dsh-character-test-home')),homes=marked?pathToFileURL(dirname(resolvePath(process.env.DSH_HOME))).href+'/':null,owned=url=>!!url&&(url.startsWith(project)||(!!homes&&url.startsWith(homes)));
registerHooks({resolve(specifier,context,next){
 if(owned(context.parentURL)||/\/(?:plugin-sources|node_modules)\/dsh-conversation-manager\//.test(context.parentURL??'')){
  if(specifier.startsWith('@deepseek-ai/'))return next(specifier,{...context,parentURL:pathToFileURL(runtime+'/resources/app.asar/dsh/package.json').href});
  if(context.parentURL.includes('/qq-fixture/')&&!specifier.startsWith('.')&&!specifier.startsWith('node:'))return next(specifier,{...context,parentURL:pathToFileURL(process.env.DSH_QQTK_PROJECT+'/node_modules/@tencent-connect/dsh-qqbot/package.json').href});
 }
 return next(specifier,context);
}});
