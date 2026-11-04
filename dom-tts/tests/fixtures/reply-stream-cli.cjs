// Real CLI input loop; supplied test transport only, never private state discovery.
const voice=require('../../scripts/browser-speak');
voice.connection=()=>({port:Number(process.env.DOM_TTS_TEST_PORT),token:process.env.DOM_TTS_TEST_TOKEN});
require('../../scripts/reply-stream').main().catch(()=>{console.error('fixture-refused');process.exitCode=1;});
