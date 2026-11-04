// Compatibility helper retained for callers of the 0.3 baseline.
function sapiRate(speed){return Math.max(-10,Math.min(10,Math.round((Number(speed)-1)*10)));}
module.exports={sapiRate};

