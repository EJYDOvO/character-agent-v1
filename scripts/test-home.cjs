// Isolated native-test Homes live outside every git work tree.
// DSH's workspace-changes plugin snapshots the repository that encloses a
// Session's working directory at each turn end (`git add --all` through a
// private index). A Home inside this project made every gate snapshot the
// developer's working copy, and a Host stopped mid-snapshot left an orphaned
// git holding the gate runner's output pipe. Run pointers (test-data/*-run.json)
// stay in the project; only the Homes the Hosts run in move out.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const MARKER='.dsh-character-test-home';
function enclosingRepository(dir){
 for(let d=path.resolve(dir);;){if(fs.existsSync(path.join(d,'.git')))return d;const up=path.dirname(d);if(up===d)return null;d=up;}
}
// DSH_CHARACTER_TEST_ROOT overrides the default <system temp>/dsh-character-gates.
function testRoot(){
 const root=path.resolve(process.env.DSH_CHARACTER_TEST_ROOT||path.join(os.tmpdir(),'dsh-character-gates'));
 const repo=enclosingRepository(root);if(repo)throw Error('Native test Homes must be outside any git work tree; '+root+' is inside '+repo);
 fs.mkdirSync(root,{recursive:true});return root;
}
/** A new, empty, marked Home: <root>/<prefix>-<uuid>. */
function newHome(prefix){const home=path.join(testRoot(),prefix+'-'+randomUUID());fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,MARKER),prefix+'\n');return home;}
/** A Home created by newHome and still outside any git work tree (TEMP may differ by then). */
const isTestHome=home=>fs.existsSync(path.join(path.resolve(home),MARKER))&&!enclosingRepository(home);
module.exports={testRoot,newHome,isTestHome,enclosingRepository};
if(require.main===module){const [cmd,prefix]=process.argv.slice(2);console.log(cmd==='new'?newHome(prefix||'home'):testRoot());}
