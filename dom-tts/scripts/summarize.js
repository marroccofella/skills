const MODES=['full','informative','summary','action-items','errors-only','warnings-only','terminal-summary','diff-summary'];
// Tables are spoken row by row as "Header: value" pairs; the separator row is never spoken.
const TABLE_SEPARATOR=/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
function tableCells(line){return line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(cell=>inline(cell.trim().replace(/\\\|/g,'|')));}
function tableRow(header,row){const parts=row.map((cell,i)=>!cell?'':header[i]&&header[i]!==cell?header[i]+': '+cell:cell).filter(Boolean);if(!parts.length)return '';const text=parts.join(', ');return /[.!?:;]$/.test(text)?text:text+'.';}
function inline(line){return line.replace(/^\s{0,3}(?:>\s?)+/,'').replace(/^\s{0,3}#{1,6}\s+/,'').replace(/^\s*(?:[-*+] |\d+[.)] )/,'').replace(/^\[[ xX]\]\s*/,'').replace(/!\[([^\]]*)\]\([^)]+\)/g,'$1').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/\*([^*\n]+)\*/g,'$1').replace(/(?<!\w)_([^_\n]+)_(?!\w)/g,'$1').replace(/~~([^~]+)~~/g,'$1');}
function markdown(text,{includeCodeBlocks=false,includeCommandBlocks=false}={}){
 let fence=null,skipped=false,skippedDiff=false,table=null;const output=[],lines=String(text||'').replace(/\r\n/g,'\n').split('\n');
 const endTable=()=>{if(table&&!table.rows){const spoken=tableRow([],table.header);if(spoken)output.push(spoken);}table=null;};
 for(let i=0;i<lines.length;i++){
 const line=lines[i],match=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
 if(match){endTable();if(!fence){fence={char:match[1][0],length:match[1].length};if(!includeCodeBlocks)skipped=true;continue;}if(match[1][0]===fence.char&&match[1].length>=fence.length&&!match[2].trim()){fence=null;continue;}}
 if(fence&&!includeCodeBlocks)continue;
 if(!fence){
  if(table&&line.includes('|')&&line.trim()){const spoken=tableRow(table.header,tableCells(line));if(spoken)output.push(spoken);table.rows++;continue;}
  endTable();
  if(line.includes('|')&&i+1<lines.length&&lines[i+1].includes('|')&&TABLE_SEPARATOR.test(lines[i+1])){table={header:tableCells(line),rows:0};i++;continue;}
 }
 if(!fence&&!includeCodeBlocks){
  // Unified diffs and Python stack frames are skipped like code; the exception line itself is kept.
  if(/^diff --git |^@@ -\d/.test(line)||(/^--- \S/.test(line)&&/^\+\+\+ \S/.test(lines[i+1]||''))){while(i+1<lines.length&&/^(?:[-+ @\\]|diff |index |new file|deleted file|similarity|rename )/.test(lines[i+1])&&lines[i+1].trim())i++;skippedDiff=true;continue;}
  if(/^Traceback \(most recent call last\):/.test(line)){while(i+1<lines.length&&/^\s+\S/.test(lines[i+1]))i++;continue;}
 }
 if(/^\s*(?:[-*_]\s*){3,}$/.test(line))continue;
 if(!includeCommandBlocks&&/^\s*(?:\$\s+|PS [^>]*>\s*|>\s*)?(?:git\s+(?:push|pull|status|diff|commit|add|clone|checkout|switch|fetch|log|reset|restore)\b|npm\s+(?:test|install|run|ci|start|build)\b|node\s+\S+\.(?:[cm]?js)\b|python\s+(?:-\w|\S+\.py\b)|powershell\s+-\w|cd\s+(?:[./~]|[A-Za-z]:\\))/i.test(line))continue;
 output.push(inline(line));
 }
 endTable();if(skippedDiff)output.push('I skipped a diff.');if(skipped)output.push('I skipped a code block.');
 return output.join('\n').replace(/\b([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9_]+)\b/g,m=>m.replace(/_/g,' ')).replace(/\b[a-z]{2,}[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g,m=>m.replace(/([a-z])([A-Z])/g,'$1 $2')).replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
function sentences(text,limit){const chunks=[];let start=0;for(let i=0;i<text.length;i++)if(/[.!?]/.test(text[i])&&(i===text.length-1||/\s/.test(text[i+1]))){const prefix=text.slice(0,i+1);if(/\b(?:e\.g\.|i\.e\.|etc\.|Dr\.|Mr\.|Mrs\.|Ms\.|Prof\.|vs\.)$/i.test(prefix))continue;chunks.push(text.slice(start,i+1).trim());start=i+1;if(chunks.length>=limit)return chunks.join(' ');}if(text.slice(start).trim())chunks.push(text.slice(start).trim());return chunks.slice(0,limit).join(' ');}
function applyMode(text,mode='informative',profile='conversational',options={}){
 if(!MODES.includes(mode))throw new Error('Unknown narration mode: '+mode);
 // Log modes read fenced output too: build and test logs are usually pasted inside fences.
 const logMode=['errors-only','warnings-only','terminal-summary'].includes(mode);
 const clean=markdown(text,{...options,includeCodeBlocks:mode==='full'||logMode||options.includeCodeBlocks,includeCommandBlocks:mode==='full'||options.includeCommandBlocks}),lines=clean.split('\n').map(x=>x.trim()).filter(Boolean);
 if(mode==='summary')return sentences(clean,profile==='concise'?2:3);
 if(mode==='action-items'){const hits=lines.filter(x=>/\b(todo|next|action|follow up|fix|implement|verify|ship|decide|needs?|must|should)\b/i.test(x));return hits.length?hits.join('\n'):sentences(clean,2);}
 if(mode==='errors-only'||mode==='warnings-only'){const pattern=mode==='errors-only'?/\b(error|failed|failure|exception|fatal|traceback|cannot|denied|not found|exit code [1-9])\b|\w(?:Error|Exception)\b/i:/\b(warn|warning|deprecated|caution|risk|skipped|unstable)\b/i;const hits=lines.filter(x=>pattern.test(x));return hits.length?hits.join('\n'):(mode==='errors-only'?'No clear errors found.':'No clear warnings found.');}
 if(mode==='terminal-summary')return sentences(lines.filter(x=>/\b(error|fail|warning)\b|\w(?:Error|Exception)\b/i.test(x)).join(' ')||lines.slice(-5).join(' '),3);
 if(mode==='diff-summary'){const raw=String(text).split(/\r?\n/),files=[...new Set(raw.map(x=>x.match(/^diff --git a\/(.+?) b\//)?.[1]).filter(Boolean))];const added=raw.filter(x=>x.startsWith('+')&&!x.startsWith('+++')).length,removed=raw.filter(x=>x.startsWith('-')&&!x.startsWith('---')).length;if(!files.length&&!raw.some(line=>/^(?:@@|--- |\+\+\+ )/.test(line)))return sentences(clean,3);return 'Diff summary. '+(files.length?'Files touched: '+files.slice(0,6).join(', ')+'. ':'')+added+' added lines and '+removed+' removed lines.';}
 return clean;
}
function chunkText(text,maxChars=420,speed=1){
 if(!Number.isInteger(maxChars)||maxChars<40||maxChars>4000)throw new Error('maxChunkChars must be an integer from 40 to 4000');
 if(!Number.isFinite(speed)||speed<0.5||speed>2)throw new Error('speed must be between 0.5 and 2');
 // Conservative budget: eight characters/second, ninety seconds, adjusted for speed.
 const limit=Math.min(maxChars,Math.floor(8*speed*90));let rest=String(text||'').trim();const chunks=[];
 while(rest.length>limit){let end=limit;const whitespace=rest.slice(0,limit+1).search(/\s+\S*$/);if(whitespace>0)end=whitespace;if(/[\uD800-\uDBFF]/.test(rest[end-1])&&/[\uDC00-\uDFFF]/.test(rest[end]))end--;chunks.push(rest.slice(0,end).trim());rest=rest.slice(end).trimStart();}if(rest)chunks.push(rest);return chunks;
}
module.exports={MODES,applyMode,chunkText,markdown,sentences};


