'use strict';
const video=document.getElementById('watch-video'),status=document.getElementById('share-status');
function timeFromUrl(){const n=Number(new URL(location.href).searchParams.get('t'));return Number.isFinite(n)&&n>=0?n:0;}
function seek(seconds){if(video&&Number.isFinite(video.duration))video.currentTime=Math.min(Math.max(0,seconds),Math.max(0,video.duration-.1));}
video?.addEventListener('loadedmetadata',()=>seek(timeFromUrl()));
if(video?.readyState>=1)seek(timeFromUrl());
window.addEventListener('popstate',()=>seek(timeFromUrl()));
document.querySelectorAll('[data-seek]').forEach(a=>a.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',a.getAttribute('href'));seek(Number(a.dataset.seek));video?.scrollIntoView({behavior:'instant',block:'center'});video?.play().catch(()=>{status.textContent='Press Play to begin this chapter.';});}));
function shareUrl(){const url=new URL(document.querySelector('link[rel="canonical"]').href);if(video?.currentTime>0)url.searchParams.set('t',Number(video.currentTime.toFixed(3)));return url.href;}
async function copy(url){try{await navigator.clipboard.writeText(url);status.textContent='Link copied. Share it with someone who uses an AI agent.';}catch{const field=document.getElementById('share-link');field.parentElement.hidden=false;field.value=url;field.focus();field.select();status.textContent='Select and copy the link below.';}}
document.getElementById('copy-video')?.addEventListener('click',()=>copy(shareUrl()));
document.getElementById('share-video')?.addEventListener('click',async event=>{const button=event.currentTarget,url=shareUrl();if(navigator.share){try{await navigator.share({title:button.dataset.title,text:button.dataset.text,url});status.textContent='Share action completed.';}catch(e){if(e.name!=='AbortError')await copy(url);}}else await copy(url);});
