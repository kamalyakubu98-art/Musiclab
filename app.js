const $=id=>document.getElementById(id);
let ctx=null, beat=null, vocal=null, micStream=null, micSource=null, micMonitorGain=null;
let nodes={}, playing=false, recording=false, startedAt=0, offset=0, loop=false;
let beatSource=null,vocalSource=null,recorder=null,recordChunks=[],recordStartedAt=0;
let muted={beat:false,vocal:false},solo={beat:false,vocal:false},autos=[];
let currentPitchRatio=1;

const db=v=>Math.pow(10,v/20);
function audio(){if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();return ctx}
function makeImpulse(seconds=2.2,decay=2.2){
  const c=audio(), n=Math.floor(c.sampleRate*seconds), b=c.createBuffer(2,n,c.sampleRate);
  for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,decay)}
  return b
}
function makeCurve(amount){
  const n=44100,c=new Float32Array(n);
  for(let i=0;i<n;i++){let x=i*2/n-1;c[i]=(1+amount)*x/(1+amount*Math.abs(x))}
  return c
}
function buildChain(input, output){
  const c=audio();
  const gate=c.createDynamicsCompressor();gate.threshold.value=+$('#gate').value;gate.knee.value=20;gate.ratio.value=20;gate.attack.value=.003;gate.release.value=.15;
  const low=c.createBiquadFilter();low.type='lowshelf';low.frequency.value=120;
  const mid=c.createBiquadFilter();mid.type='peaking';mid.frequency.value=1200;mid.Q.value=1;
  const high=c.createBiquadFilter();high.type='highshelf';high.frequency.value=6500;
  const comp=c.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=18;comp.ratio.value=+$('#comp').value;comp.attack.value=.005;comp.release.value=.12;
  const sh=c.createWaveShaper();sh.oversample='2x';
  const gain=c.createGain();
  const delay=c.createDelay(2);const dg=c.createGain();
  const con=c.createConvolver();con.buffer=makeImpulse();const rg=c.createGain();
  input.connect(gate).connect(low).connect(mid).connect(high).connect(comp).connect(sh).connect(gain);
  sh.connect(delay).connect(dg).connect(output);
  sh.connect(con).connect(rg).connect(output);
  gain.connect(output);
  nodes={gate,low,mid,high,comp,sh,gain,delay,dg,con,rg,output};
  updateFX();
  return nodes
}
function updateFX(){
  if(!nodes.gain)return;
  nodes.gain.gain.value=+$('#gain').value;
  nodes.gate.threshold.value=+$('#gate').value;
  nodes.low.gain.value=+$('#low').value;
  nodes.mid.gain.value=+$('#mid').value;
  nodes.high.gain.value=+$('#high').value;
  nodes.comp.ratio.value=+$('#comp').value;
  nodes.sh.curve=makeCurve(+$('#sat').value/22);
  nodes.dg.gain.value=+$('#delay').value/100;
  nodes.delay.delayTime.value=Math.min(1.2,0.18+ (+$('#delay').value/80)*0.42);
  nodes.rg.gain.value=+$('#reverb').value/100;
  const labels={gain:'',gate:' dB',low:' dB',mid:' dB',high:' dB',comp:':1',sat:'%',delay:'%',reverb:'%',tune:'%',human:'%',master:'%'};
  ['gain','gate','low','mid','high','comp','sat','delay','reverb','tune','human','master'].forEach(k=>{const o=$(k+'Out');if(o)o.textContent=$(k).value+(labels[k]||'')});
}
async function loadFile(file,type){
  audio();await ctx.resume();
  const b=await ctx.decodeAudioData(await file.arrayBuffer());
  if(type==='beat'){beat=b;$('beatState').textContent=file.name;$('beatClip').style.width=Math.max(28,Math.min(92,b.duration/60*100))+'%'}
  else{vocal=b;$('vocalState').textContent=file.name;$('vocalClip').style.width=Math.max(28,Math.min(92,b.duration/60*100))+'%';analyzePitch()}
}
$('beatBtn').onclick=()=>$('beatFile').click();
$('vocalBtn').onclick=()=>$('vocalFile').click();
$('beatFile').onchange=e=>e.target.files[0]&&loadFile(e.target.files[0],'beat');
$('vocalFile').onchange=e=>e.target.files[0]&&loadFile(e.target.files[0],'vocal');

async function enableMic(){
  audio();await ctx.resume();
  if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;micSource=null;$('mic').textContent='🎙 Enable Mic';$('recordState').textContent='Mic off';return}
  if(!navigator.mediaDevices?.getUserMedia){$('recordState').textContent='Microphone unavailable in this browser';return}
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  micSource=ctx.createMediaStreamSource(micStream);
  micMonitorGain=ctx.createGain();micMonitorGain.gain.value=$('monitor').checked?1:0;
  buildChain(micSource,micMonitorGain);micMonitorGain.connect(ctx.destination);
  $('mic').textContent='🎙 Mic enabled';$('recordState').textContent='Mic ready — use headphones'
}
$('mic').onclick=()=>enableMic().catch(e=>$('recordState').textContent='Mic error: '+e.message);
$('monitor').onchange=()=>{if(micMonitorGain)micMonitorGain.gain.value=$('monitor').checked?1:0};

function allowed(t){if(solo.beat||solo.vocal)return solo[t];return !muted[t]}
function stopSources(){
  if(beatSource)try{beatSource.stop()}catch{}
  if(vocalSource)try{vocalSource.stop()}catch{}
  beatSource=vocalSource=null
}
function stop(){
  if(playing){offset=Math.max(0,ctx.currentTime-startedAt)}
  stopSources();playing=false;$('play').textContent='▶ Play'
}
function start(){
  audio();ctx.resume();if(playing)return;
  const now=ctx.currentTime;
  if(beat&&allowed('beat')&&$('beatMonitor').checked){
    beatSource=ctx.createBufferSource();beatSource.buffer=beat;beatSource.connect(ctx.destination);beatSource.start(now,Math.min(offset,Math.max(0,beat.duration-.001)))
  }
  if(vocal&&allowed('vocal')){
    vocalSource=ctx.createBufferSource();vocalSource.buffer=vocal;vocalSource.playbackRate.value=currentPitchRatio;
    const out=ctx.createGain();vocalSource.connect(out);buildChain(out,ctx.destination);vocalSource.start(now,Math.min(offset,Math.max(0,vocal.duration-.001)))
  }
  startedAt=now-offset;playing=true;$('play').textContent='❚❚ Pause';tick()
}
$('play').onclick=()=>{if(playing)stop();else start()};
$('stop').onclick=()=>{stop();offset=0};
$('loop').onclick=()=>{loop=!loop;$('loop').style.borderColor=loop?'#72a9ff':''};

function tick(){
  if(!playing)return;
  const t=ctx.currentTime-startedAt;
  $('time').textContent=new Date(Math.max(0,t)*1000).toISOString().substr(14,5)+'.'+Math.floor((t%1)*10);
  if(loop&&beat&&t>=beat.duration){stop();offset=0;start();return}
  if((beat&&t>=beat.duration)&&(!vocal||t>=vocal.duration)){stop();return}
  requestAnimationFrame(tick)
}

document.querySelectorAll('input[type=range]').forEach(x=>x.addEventListener('input',updateFX));
document.querySelectorAll('[data-mute]').forEach(b=>b.onclick=()=>{const t=b.dataset.mute;muted[t]=!muted[t];b.style.background=muted[t]?'#6d2732':''});
document.querySelectorAll('[data-solo]').forEach(b=>b.onclick=()=>{const t=b.dataset.solo;solo[t]=!solo[t];b.style.background=solo[t]?'#765f1b':''});

const presets={
'Clean Vocal':{gain:1,gate:-55,low:0,mid:1,high:3,comp:2.5,sat:0,delay:0,reverb:8,tune:15,human:75},
'Modern Pop':{gain:1,gate:-55,low:-1,mid:2,high:5,comp:4,sat:12,delay:12,reverb:18,tune:55,human:35},
'Afro Vocal':{gain:1,gate:-56,low:2,mid:1,high:3,comp:3,sat:8,delay:18,reverb:14,tune:35,human:60},
'Warm R&B':{gain:1,gate:-55,low:3,mid:-1,high:-1,comp:3,sat:15,delay:10,reverb:22,tune:25,human:80},
'Telephone':{gain:1,gate:-58,low:-18,mid:6,high:-12,comp:5,sat:5,delay:0,reverb:0,tune:0,human:100},
'Bright Lead':{gain:1,gate:-55,low:-1,mid:2,high:8,comp:3.5,sat:5,delay:8,reverb:12,tune:45,human:45},
'Wide Delay':{gain:1,gate:-55,low:0,mid:0,high:2,comp:2,sat:4,delay:35,reverb:25,tune:15,human:65},
'Vocal Air':{gain:1,gate:-55,low:0,mid:0,high:10,comp:3,sat:2,delay:5,reverb:12,tune:20,human:80},
'Dark Rap':{gain:1.02,gate:-53,low:5,mid:2,high:-5,comp:5,sat:10,delay:6,reverb:6,tune:20,human:70}
};
$('applyPreset').onclick=()=>{const p=presets[$('preset').value];if(!p)return;Object.entries(p).forEach(([k,v])=>$(k).value=v);updateFX();$('aiStatus').textContent=$('preset').value+' preset applied.'};

function addAutomation(){
  const s=+$('#autoStart').value,e=+$('#autoEnd').value;
  if(e<=s){$('aiStatus').textContent='Automation end must be after start.';return}
  autos.push({p:$('#autoParam').value,s,e,f:+$('#autoFrom').value,t:+$('#autoTo').value});renderAutos()
}
$('addAuto').onclick=addAutomation;
function renderAutos(){$('autoList').innerHTML=autos.map((a,i)=>`<div class="automation-item">${a.p}: ${a.s}s → ${a.e}s | ${a.f} → ${a.t}<button onclick="autos.splice(${i},1);renderAutos()">remove</button></div>`).join('')}
function applyAutomation(time){
  autos.forEach(a=>{
    if(time>=a.s&&time<=a.e){
      const v=a.f+(a.t-a.f)*(time-a.s)/(a.e-a.s), el=$(a.p);
      if(el){el.value=v;updateFX()}
    }
  })
}

function noteIndex(name){return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(name)}
function nearestScalePitch(midi,key,scale){
  const root=noteIndex(key), allowed=scale==='Chromatic'?[0,1,2,3,4,5,6,7,8,9,10,11]:scale==='Major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];
  let best=midi,bestD=999;
  for(let d=-12;d<=12;d++){const m=midi+d, pc=((m%12)+12)%12, rel=(pc-root+12)%12;if(allowed.includes(rel)&&Math.abs(d)<bestD){best=m;bestD=Math.abs(d)}}
  return best
}
function estimatePitch(buffer){
  const data=buffer.getChannelData(0), sr=buffer.sampleRate, step=Math.max(1,Math.floor(sr/2000)), maxLag=Math.floor(sr/70), minLag=Math.floor(sr/900);
  let sum=0,count=0;
  for(let start=0;start+maxLag<data.length;start+=sr*.25){
    let bestLag=minLag,best=-Infinity;
    for(let lag=minLag;lag<=maxLag;lag+=step){
      let corr=0,energy=0;
      const n=Math.min(Math.floor(sr*.035),data.length-start-lag);
      for(let i=0;i<n;i+=4){const a=data[start+i],b=data[start+i+lag];corr+=a*b;energy+=a*a+b*b}
      const score=energy?corr/energy:0;
      if(score>best){best=score;bestLag=lag}
    }
    if(best>.08){sum+=sr/bestLag;count++}
  }
  return count?sum/count:null
}
function analyzePitch(){
  if(!vocal){return}
  const f=estimatePitch(vocal);
  if(!f){$('pitchInfo').textContent='Pitch engine: no stable vocal pitch detected.';currentPitchRatio=1;return}
  const midi=69+12*Math.log2(f/440), target=nearestScalePitch(Math.round(midi),$('#key').value,$('#scale').value), semis=target-midi;
  const strength=+$('#tune').value/100, human=+$('#human').value/100;
  const effective=strength*(1-human);
  currentPitchRatio=Math.pow(2,(semis*effective)/12);
  $('pitchInfo').textContent=`Detected average ${f.toFixed(1)} Hz • target ${target.toFixed(0)} MIDI • correction ${(semis*effective).toFixed(2)} semitones. This is a functional average-pitch correction preview, not a note-by-note commercial Auto-Tune engine.`;
}
['tune','human','key','scale'].forEach(id=>$(id).addEventListener('input',analyzePitch));
function rebuildPitch(){analyzePitch();if(playing){const t=ctx.currentTime-startedAt;stop();offset=t;start()}}

$('runAI').onclick=()=>{
  const s=$('ai').value.toLowerCase(),applied=[];
  const pct=(term,id)=>{const m=s.match(new RegExp(term+'\\\\s*(?:to|at)?\\\\s*(\\\\d{1,3})%'));if(m)$(id).value=Math.max(0,Math.min(100,+m[1]))};
  if(s.includes('bright')){$('high').value=6;applied.push('high EQ +6 dB')}
  if(s.includes('warm')){$('low').value=3;$('high').value=-2;applied.push('warm EQ')}
  if(s.includes('dark')){$('high').value=-5;applied.push('high EQ -5 dB')}
  if(s.includes('compress')){$('comp').value=4;applied.push('4:1 compression')}
  if(s.includes('echo')||s.includes('delay')){pct('(?:echo|delay)',$('delay').id);if(+$('delay').value===0)$('delay').value=25;applied.push('echo '+$('delay').value+'%')}
  if(s.includes('reverb')){pct('reverb',$('reverb').id);if(+$('reverb').value===0)$('reverb').value=20;applied.push('reverb '+$('reverb').value+'%')}
  if(s.includes('saturation')){pct('saturation',$('sat').id);if(+$('sat').value===0)$('sat').value=12;applied.push('saturation '+$('sat').value+'%')}
  if(s.includes('noise')||s.includes('clean')){$('gate').value=-50;applied.push('noise gate -50 dB')}
  if(s.includes('human')){pct('humanize',$('human').id);if(+$('human').value===0)$('human').value=60;applied.push('humanize '+$('human').value+'%')}
  if(s.includes('tune')||s.includes('auto-tune')||s.includes('autotune')){pct('(?:auto[- ]?tune|tune)',$('tune').id);if(+$('tune').value===0)$('tune').value=60;applied.push('pitch correction '+$('tune').value+'%')}
  if(s.includes('vocal louder')){$('gain').value=1.25;applied.push('vocal gain 1.25')}
  if(s.includes('vocal softer')){$('gain').value=.8;applied.push('vocal gain 0.8')}
  updateFX();analyzePitch();
  $('aiStatus').textContent=applied.length?'Applied: '+applied.join(', '):'No matching command. Try “make vocal brighter”, “warm it up”, “compress 4:1”, “add 25% echo”, “15% reverb”, “humanize 60%”, “auto-tune 70%”, or “reduce noise”.'
};

async function startRecording(){
  await enableMic();
  if(!micStream)return;
  audio();await ctx.resume();
  recordChunks=[];recorder=new MediaRecorder(micStream,{mimeType:MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm'});
  recorder.ondataavailable=e=>e.data.size&&recordChunks.push(e.data);
  recorder.onstop=async()=>{
    const blob=new Blob(recordChunks,{type:recorder.mimeType});
    const ab=await blob.arrayBuffer();
    try{vocal=await ctx.decodeAudioData(ab);$('vocalState').textContent='Recorded take ('+vocal.duration.toFixed(1)+'s)';$('vocalClip').style.width=Math.max(28,Math.min(92,vocal.duration/60*100))+'%';analyzePitch();$('recordState').textContent='Take captured.'}
    catch(e){$('recordState').textContent='Could not decode take: '+e.message}
  };
  recorder.start(250);recording=true;recordStartedAt=performance.now();$('record').textContent='■ Stop Recording';$('recordState').textContent='Recording…';
  if(beat&&$('beatMonitor').checked){stop();offset=0;start()}
}
$('record').onclick=async()=>{
  try{
    if(recording){recording=false;recorder.stop();$('record').textContent='● Record';$('recordState').textContent='Finishing take…';return}
    await startRecording()
  }catch(e){recording=false;$('recordState').textContent='Recording error: '+e.message}
};

async function renderMix(){
  audio();const dur=Math.max(beat?.duration||0,vocal?.duration||0,10),off=new OfflineAudioContext(2,Math.ceil(dur*ctx.sampleRate),ctx.sampleRate);
  const master=off.createGain();master.gain.value=+$('master').value/100;master.connect(off.destination);
  if(beat&&allowed('beat')){const s=off.createBufferSource();s.buffer=beat;s.connect(master);s.start()}
  if(vocal&&allowed('vocal')){
    const s=off.createBufferSource();s.buffer=vocal;s.playbackRate.value=currentPitchRatio;
    const out=off.createGain();out.gain.value=+$('gain').value;
    const lo=off.createBiquadFilter();lo.type='lowshelf';lo.frequency.value=120;lo.gain.value=+$('low').value;
    const mi=off.createBiquadFilter();mi.type='peaking';mi.frequency.value=1200;mi.Q.value=1;mi.gain.value=+$('mid').value;
    const hi=off.createBiquadFilter();hi.type='highshelf';hi.frequency.value=6500;hi.gain.value=+$('high').value;
    const co=off.createDynamicsCompressor();co.threshold.value=-18;co.knee.value=18;co.ratio.value=+$('comp').value;co.attack.value=.005;co.release.value=.12;
    const sh=off.createWaveShaper();sh.curve=makeCurve(+$('sat').value/22);sh.oversample='2x';
    const d=off.createDelay(2);d.delayTime.value=.18+(+$('delay').value/80)*.42;const dg=off.createGain();dg.gain.value=+$('delay').value/100;
    const rv=off.createConvolver();rv.buffer=makeImpulse.call({});const rg=off.createGain();rg.gain.value=+$('reverb').value/100;
    s.connect(out).connect(lo).connect(mi).connect(hi).connect(co).connect(sh).connect(master);
    sh.connect(d).connect(dg).connect(master);sh.connect(rv).connect(rg).connect(master);s.start()
  }
  return off.startRendering()
}
function wav(ab){
  const ch=ab.numberOfChannels,len=ab.length,buf=new ArrayBuffer(44+len*ch*2),v=new DataView(buf);
  const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+len*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,ab.sampleRate,true);v.setUint32(28,ab.sampleRate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,len*ch*2,true);
  let p=44;for(let i=0;i<len;i++)for(let c=0;c<ch;c++){let x=Math.max(-1,Math.min(1,ab.getChannelData(c)[i]));v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return new Blob([buf],{type:'audio/wav'})
}
$('export').onclick=async()=>{
  if(!beat&&!vocal){$('aiStatus').textContent='Import or record a beat/vocal first.';return}
  $('aiStatus').textContent='Rendering mix…';
  try{const r=await renderMix(),u=URL.createObjectURL(wav(r));$('download').href=u;$('download').download='musiclab_mix.wav';$('download').hidden=false;$('aiStatus').textContent='Render complete.'}
  catch(e){$('aiStatus').textContent='Render failed: '+e.message}
};

setInterval(()=>{if(playing){applyAutomation(ctx.currentTime-startedAt);const v=Math.min(100,+$('#master').value);$('meterFill').style.width=(Math.random()*v*.45+v*.35)+'%'}},80);
updateFX();
