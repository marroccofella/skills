// Owned test process only: Windows child.kill(SIGTERM) is forced termination,
// so IPC deliberately invokes the production graceful signal handler.
process.on('message',message=>{if(message?.type==='close-test-owner')process.emit('SIGTERM');});
require('../../scripts/experimental/browser-session').main().catch(()=>{console.error('fixture-companion-start-refused');process.exit(1);});
