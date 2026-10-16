const path=require('node:path');
const value=process.env.DSH_INSTALL_ROOT;
if(!value||!path.isAbsolute(value))throw Error('Set DSH_INSTALL_ROOT to an absolute existing DSH installation path.');
module.exports={install:path.resolve(value)};
