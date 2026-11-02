const path=require('node:path');
module.exports={node:process.execPath,pnpm:path.join(path.dirname(require.resolve('pnpm')),require('pnpm').bin.pnpm),yaml:require('js-yaml')};
