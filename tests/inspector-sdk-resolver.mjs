// Isolated test launcher only. Resolve source imports against the exact installed
// SDK without copying or editing vendor files or installing dependencies.
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const project=new URL('../',import.meta.url).href;
const runtime=pathToFileURL(process.env.DSH_INSTALL_ROOT+'/resources/app.asar/dsh/package.json').href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.startsWith(project)&&specifier.startsWith('@deepseek-ai/'))return next(specifier,{...context,parentURL:runtime});
 return next(specifier,context);
}});
