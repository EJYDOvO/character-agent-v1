// Native Agent-scoped enforcement. This is not a Spawn provider or an approval bypass.
export const name='character-analysis-worker-boundary';
export const inject=['tools'];
export function apply(ctx){
 ctx.tools.restrict({allow:[]});
 ctx.tools.guard(()=> 'Analysis Worker cannot execute tools. Return a proposal to the parent for independent review and approval.');
}
