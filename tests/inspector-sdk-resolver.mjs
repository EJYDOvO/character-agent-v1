// Isolated test launcher only. Resolve source imports against the exact installed
// SDK without copying or editing vendor files or installing dependencies.
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {dirname,resolve as resolvePath} from 'node:path';
import {existsSync} from 'node:fs';
const project=new URL('../',import.meta.url).href;
// Code of this project, and fixtures staged into isolated test Homes. Homes are
// siblings under one root outside the git work tree (scripts/test-home.cjs); a
// marked DSH_HOME names that root, so fixtures staged into another Home of the
// same run (e.g. the interaction transport used by roles) are covered too.
const marked=process.env.DSH_HOME&&existsSync(resolvePath(process.env.DSH_HOME,'.dsh-character-test-home')),homes=marked?pathToFileURL(dirname(resolvePath(process.env.DSH_HOME))).href+'/':null,owned=url=>!!url&&(url.startsWith(project)||(!!homes&&url.startsWith(homes)));
const runtime=pathToFileURL((process.env.DSH_CHARACTER_HOST_ROOT||process.env.DSH_INSTALL_ROOT)+'/resources/app.asar/dsh/package.json').href;
registerHooks({resolve(specifier,context,next){
 if(owned(context.parentURL)&&specifier.startsWith('@deepseek-ai/'))return next(specifier,{...context,parentURL:runtime});
 return next(specifier,context);
}});
