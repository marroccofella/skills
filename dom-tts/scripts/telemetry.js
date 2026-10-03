// 0.4 stores operational counters only; no speech text, transcript paths or raw errors.
const fs=require('node:fs'),path=require('node:path');
const {stateDir}=require('./runtime');
const TELEMETRY=path.join(stateDir,'telemetry.jsonl');
function appendTelemetry(event){const output={timestamp:new Date().toISOString()};for(const key of ['chunks','chunkIndex','chunkChars','durationMs'])if(Number.isSafeInteger(event[key])&&event[key]>=0)output[key]=event[key];return output;}
function readTelemetry(){return [];}
module.exports={TELEMETRY,appendTelemetry,readTelemetry};

