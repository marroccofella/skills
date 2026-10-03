const {selectProvider,available,voices}=require('./providers/native');
const {parseCli}=require('./runtime');
function doctor(){let provider,error;try{provider=selectProvider();}catch(e){error=e.message;}return {version:require('../package.json').version,platform:process.platform,arch:process.arch,node:process.version,provider,available:provider?available(provider):false,error};}
if(require.main===module){try{const args=parseCli(process.argv.slice(2),{},['voices']);const info=doctor();if(args.voices==='true')info.voices=voices(info.provider);console.log(JSON.stringify(info,null,2));if(!info.available)process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={doctor};

