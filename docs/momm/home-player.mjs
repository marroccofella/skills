// Progressive enhancement: real links and native controls work without JavaScript.
export function bindHomePlayers(doc) {
  const videos=[...doc.querySelectorAll('.home-cinema video')];
  const status=doc.getElementById('home-player-status');
  const say=message=>{if(status)status.textContent=message;};
  for(const video of videos)video.addEventListener('play',()=>{
    for(const other of videos)if(other!==video)other.pause();
    const overlay=doc.querySelector(`.film-start[data-play="${video.id}"]`);
    if(overlay)overlay.hidden=true;
  });
  for(const link of doc.querySelectorAll('[data-play]'))link.addEventListener('click',async event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const video=doc.getElementById(link.dataset.play);
    if(!video)return;
    event.preventDefault();
    const raw=Number(link.dataset.time??0),time=Number.isFinite(raw)?Math.max(0,raw):0;
    const seek=()=>{video.currentTime=Number.isFinite(video.duration)?Math.min(time,Math.max(0,video.duration-.1)):time;};
    if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});
    video.scrollIntoView?.({behavior:'instant',block:'center'});
    video.focus({preventScroll:true});
    try {await video.play();if(time>0)seek();say(`Playing: ${video.getAttribute('aria-label')}.`);}
    catch {say('Playback did not start. Use the video’s Play control, or open its transcript and download link.');}
  });
}
if(typeof document!=='undefined')bindHomePlayers(document);
