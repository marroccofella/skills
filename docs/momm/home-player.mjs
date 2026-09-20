// Progressive enhancement: real links and native controls work without JavaScript.
export function bindHomePlayers(doc) {
  const nav=doc.querySelector('.site-header nav');
  if(nav && !nav.querySelector('a[href="media.html"]')){const link=doc.createElement('a');link.href='media.html';link.textContent='Media';nav.append(link);}
  const current=doc.getElementById('home-film');
  if(current){
    current.setAttribute('poster','films/overview-1.16.0/poster.jpg');
    const source=current.querySelector('source'); if(source) source.src='films/overview-1.16.0/walkthrough.mp4';
    const track=current.querySelector('track'); if(track) track.src='films/overview-1.16.0/captions.vtt';
    const fallback=current.querySelector('a'); if(fallback) fallback.href='films/overview-1.16.0/walkthrough.mp4';
    current.load();
    const play=doc.querySelector('.film-start[data-play="home-film"]');
    if(play){play.href='watch/overview-1.16.0.html';play.setAttribute('aria-label','Play the MOMM 1.16.0 introduction here');}
  }
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
