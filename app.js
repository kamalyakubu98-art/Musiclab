/* MUSICLAB DAW v3.3
   Browser-first mobile DAW engine.
   - MP4/M4A beat import where the browser decoder supports the file
   - Real mic monitoring + recording without toggling the mic off
   - Browser noise suppression + adaptive gate for fan/room noise
   - Circular knob controls
   - Functional FX chain, presets, automation, export
   - Average-pitch correction preview (not commercial note-by-note Auto-Tune)
*/
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    ctx:null, beat:null, vocal:null, beatMedia:null,
    micStream:null, micSource:null, micMonitorGain:null, micRecordDest:null, micChain:null, beatMediaSource:null,
    micGateGain:null, micAnalyser:null, micNoiseTimer:null, noiseFloor:0.01, noiseCalibrating:false,
    beatSource:null, vocalSource:null, beatGain:null, vocalGain:null, recorder:null, recordChunks:[],
    recording:false, playing:false, startedAt:0, offset:0, loop:false,
    muted:{beat:false,vocal:false}, solo:{beat:false,vocal:false}, automations:[],
    currentPitchRatio:1, currentPitchSemitones:0
  };

  function audio(){
    if(!state.ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio is not supported');state.ctx=new AC();}
    return state.ctx;
  }
  async function resumeAudio(){const c=audio();if(c.state==='suspended')await c.resume();return c;}
  function status(t){if($('recordState'))$('recordState').textContent=t;}
  function makeImpulse(ctx,seconds=1.8,decay=2.5){
    const n=Math.max(1,Math.floor(ctx.sampleRate*seconds)),b=ctx.createBuffer(2,n,ctx.sampleRate);
    for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,decay)}
    return b;
  }
  function makeCurve(amount){const n=44100,c=new Float32Array(n),a=Math.max(0,Number(amount)||0);for(let i=0;i<n;i++){const x=i*2/n-1;c[i]=(1+a)*x/(1+a*Math.abs(x))}return c;}

  function updateOutputs(){
    const labels={gain:'',noiseReduce:'%',gate:' dB',low:' dB',mid:' dB',high:' dB',comp:':1',sat:'%',delay:'%',reverb:'%',tune:'%',human:'%',master:'%'};
    Object.keys(labels).forEach(k=>{const o=$(k+'Out'),i=$(k);if(o&&i)o.textContent=i.value+labels[k]});
    document.querySelectorAll('.knob-dial').forEach(d=>{
      const i=$(d.dataset.for);if(!i)return;const min=Number(i.min),max=Number(i.max),v=Number(i.value);const pct=(v-min)/(max-min||1);d.style.setProperty('--rot',`${-135+pct*270}deg`);
    });
  }

  function updateChain(chain){
    if(!chain)return;
    const v=id=>Number($(id)?.value||0);
    chain.gain.gain.value=v('gain'); chain.gate.threshold.value=v('gate');
    chain.low.gain.value=v('low'); chain.mid.gain.value=v('mid'); chain.high.gain.value=v('high');
    chain.comp.ratio.value=Math.max(1,v('comp')); chain.shaper.curve=makeCurve(v('sat')/22);
    chain.delayGain.gain.value=v('delay')/100; chain.delay.delayTime.value=Math.min(1.2,.18+(v('delay')/80)*.42);
    chain.reverbGain.gain.value=v('reverb')/100;
    updateOutputs();
  }

  function createFXChain(ctx,input,output){
    const gate=ctx.createDynamicsCompressor();gate.threshold.value=Number($('gate')?.value||-55);gate.knee.value=20;gate.ratio.value=20;gate.attack.value=.003;gate.release.value=.15;
    const low=ctx.createBiquadFilter();low.type='lowshelf';low.frequency.value=120;
    const mid=ctx.createBiquadFilter();mid.type='peaking';mid.frequency.value=1200;mid.Q.value=1;
    const high=ctx.createBiquadFilter();high.type='highshelf';high.frequency.value=6500;
    const comp=ctx.createDynamicsCompressor();comp.threshold.value=-18;comp.knee.value=18;comp.ratio.value=Number($('comp')?.value||3);comp.attack.value=.005;comp.release.value=.12;
    const shaper=ctx.createWaveShaper();shaper.oversample='2x';
    const gain=ctx.createGain(),delay=ctx.createDelay(2),delayGain=ctx.createGain(),reverb=ctx.createConvolver(),reverbGain=ctx.createGain();
    reverb.buffer=makeImpulse(ctx);
    input.connect(gate).connect(low).connect(mid).connect(high).connect(comp).connect(shaper).connect(gain);
    gain.connect(output);shaper.connect(delay).connect(delayGain).connect(output);shaper.connect(reverb).connect(reverbGain).connect(output);
    const chain={gate,low,mid,high,comp,shaper,gain,delay,delayGain,reverb,reverbGain,output};updateChain(chain);return chain;
  }

  async function loadFile(file,type){
    if(!file)return;
    const c=await resumeAudio();
    if(type==='beat'&&state.beatMedia){state.beatMedia.pause();state.beatMedia.src='';state.beatMedia=null;}
    try{
      const ab=await file.arrayBuffer();
      const buffer=await c.decodeAudioData(ab.slice(0));
      if(type==='beat'){state.beat=buffer;state.beatMedia=null;}
      else state.vocal=buffer;
      const target=type==='beat'?'beatState':'vocalState',clip=type==='beat'?'beatClip':'vocalClip';
      $(target).textContent=`${file.name} • ${buffer.duration.toFixed(1)}s`;
      $(clip).style.width=Math.max(28,Math.min(92,buffer.duration/60*100))+'%';
      if(type==='vocal')analyzePitch();
      status(`${type==='beat'?'Beat':'Vocal'} loaded.`);
    }catch(err){
      if(type!=='beat'||!/^video\/mp4|audio\/mp4|audio\/x-m4a|video\/quicktime/.test(file.type||''))throw err;
      const media=new Audio();media.src=URL.createObjectURL(file);media.preload='auto';media.playsInline=true;
      await new Promise((res,rej)=>{media.onloadedmetadata=()=>res();media.onerror=()=>rej(new Error('This MP4 audio could not be decoded by this browser.'))});
      state.beat=null;state.beatMedia=media;
      $('beatState').textContent=`${file.name} • ${media.duration.toFixed(1)}s`;$('beatClip').style.width=Math.max(28,Math.min(92,media.duration/60*100))+'%';
      status('MP4 beat loaded. Browser media playback mode is active.');
    }
  }
  $('beatBtn')?.addEventListener('click',()=>$('beatFile')?.click());$('vocalBtn')?.addEventListener('click',()=>$('vocalFile')?.click());
  $('beatFile')?.addEventListener('change',e=>loadFile(e.target.files?.[0],'beat').catch(e=>status('Beat error: '+e.message)));
  $('vocalFile')?.addEventListener('change',e=>loadFile(e.target.files?.[0],'vocal').catch(e=>status('Vocal error: '+e.message)));

  function stopSource(s){if(!s)return;try{s.stop()}catch{}try{s.disconnect()}catch{}}
  function stopBeatMedia(){if(state.beatMedia){try{state.beatMedia.pause();state.beatMedia.currentTime=0}catch{}}}
  function stopSources(){stopSource(state.beatSource);stopSource(state.vocalSource);state.beatSource=state.vocalSource=null;state.beatGain=state.vocalGain=null;stopBeatMedia();}
  function allowed(t){if(state.solo.beat||state.solo.vocal)return!!state.solo[t];return!state.muted[t];}

  async function ensureMic(){
    const c=await resumeAudio();
    if(state.micStream&&state.micSource)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone API unavailable. Use Chrome over HTTPS.');
    state.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
    state.micSource=c.createMediaStreamSource(state.micStream);
    const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=75;hp.Q.value=.7;
    state.micGateGain=c.createGain();state.micGateGain.gain.value=1;
    state.micAnalyser=c.createAnalyser();state.micAnalyser.fftSize=1024;state.micAnalyser.smoothingTimeConstant=.75;
    state.micMonitorGain=c.createGain();state.micMonitorGain.gain.value=$('monitor')?.checked?1:0;
    state.micRecordDest=c.createMediaStreamDestination();
    state.micSource.connect(hp).connect(state.micAnalyser).connect(state.micGateGain);
    state.micChain=createFXChain(c,state.micGateGain,state.micMonitorGain);
    state.micChain.gain.connect(state.micRecordDest);state.micMonitorGain.connect(c.destination);
    // Send the processed vocal output to the recording destination.
    state.micChain.output.disconnect();state.micChain.output.connect(state.micRecordDest);state.micMonitorGain.connect(c.destination);
    state.noiseFloor=.01;state.noiseCalibrating=true;
    const start=performance.now(),buf=new Float32Array(state.micAnalyser.fftSize);
    clearInterval(state.micNoiseTimer);
    state.micNoiseTimer=setInterval(()=>{
      if(!state.micAnalyser||!state.micGateGain)return;
      state.micAnalyser.getFloatTimeDomainData(buf);let sum=0;for(let i=0;i<buf.length;i++)sum+=buf[i]*buf[i];const rms=Math.sqrt(sum/buf.length);
      if(performance.now()-start<1200){state.noiseFloor=state.noiseFloor*.85+rms*.15;return}
      state.noiseCalibrating=false;
      const strength=Number($('noiseReduce')?.value||75)/100;
      const threshold=Math.max(.006,state.noiseFloor*(1.5+strength*3)+strength*.002);
      const open=rms>threshold;
      state.micGateGain.gain.setTargetAtTime(open?1:.015,c.currentTime,.025);
    },35);
    $('mic').textContent='🎙 Mic enabled';status('Mic ready — calibrating room/fan noise…');
  }
  function disableMic(){clearInterval(state.micNoiseTimer);state.micNoiseTimer=null;if(state.micStream)state.micStream.getTracks().forEach(t=>t.stop());[state.micSource,state.micGateGain,state.micAnalyser,state.micMonitorGain,state.micRecordDest].forEach(n=>{try{n?.disconnect()}catch{}});state.micStream=state.micSource=state.micGateGain=state.micAnalyser=state.micMonitorGain=state.micRecordDest=state.micChain=null;$('mic').textContent='🎙 Enable Mic';status('Mic off');}
  $('mic')?.addEventListener('click',async()=>{try{if(state.micStream)disableMic();else await ensureMic()}catch(e){status('Mic error: '+e.message)}});
  $('monitor')?.addEventListener('change',()=>{if(state.micMonitorGain)state.micMonitorGain.gain.value=$('monitor').checked?1:0;});

  function stopPlayback(reset=false){if(state.playing&&state.ctx)state.offset=Math.max(0,state.ctx.currentTime-state.startedAt);stopSources();state.playing=false;if(reset)state.offset=0;if($('play'))$('play').textContent='▶ Play';}
  async function startPlayback(){
    const c=await resumeAudio();if(state.playing)return;if(!state.beat&&!state.beatMedia&&!state.vocal){status('Load a beat or vocal first.');return;}
    const now=c.currentTime,master=c.createGain();master.gain.value=Number($('master').value)/100;master.connect(c.destination);
    const beatDur=state.beat?.duration||state.beatMedia?.duration||0;
    if((state.beat||state.beatMedia)&&allowed('beat')&&$('beatMonitor').checked){
      if(state.beat){state.beatSource=c.createBufferSource();state.beatSource.buffer=state.beat;state.beatGain=c.createGain();state.beatGain.gain.value=1;state.beatSource.connect(state.beatGain).connect(master);state.beatSource.start(now,Math.min(state.offset,Math.max(0,beatDur-.001)));}
      else {state.beatMedia.currentTime=Math.min(state.offset,Math.max(0,beatDur-.01));if(!state.beatMediaSource)state.beatMediaSource=c.createMediaElementSource(state.beatMedia);state.beatSource=state.beatMediaSource;state.beatMediaSource.disconnect();state.beatMediaSource.connect(master);await state.beatMedia.play();}
    }
    if(state.vocal&&allowed('vocal')){state.vocalSource=c.createBufferSource();state.vocalSource.buffer=state.vocal;state.vocalSource.playbackRate.value=state.currentPitchRatio;state.vocalGain=c.createGain();state.vocalGain.gain.value=1;state.vocalSource.connect(state.vocalGain);createFXChain(c,state.vocalGain,master);state.vocalSource.start(now,Math.min(state.offset,Math.max(0,state.vocal.duration-.001)));}
    state.startedAt=now-state.offset;state.playing=true;$('play').textContent='❚❚ Pause';tick();
  }
  $('play')?.addEventListener('click',()=>state.playing?stopPlayback(false):startPlayback().catch(e=>status('Playback error: '+e.message)));
  $('stop')?.addEventListener('click',()=>stopPlayback(true));$('loop')?.addEventListener('click',()=>{state.loop=!state.loop;$('loop').style.borderColor=state.loop?'#72a9ff':''});
  function tick(){if(!state.playing||!state.ctx)return;const t=Math.max(0,state.ctx.currentTime-state.startedAt);$('time').textContent=new Date(t*1000).toISOString().substr(14,5)+'.'+Math.floor((t%1)*10);const dur=Math.max(state.beat?.duration||state.beatMedia?.duration||0,state.vocal?.duration||0);if(dur&&t>=dur){if(state.loop){stopPlayback(true);startPlayback().catch(e=>status('Loop error: '+e.message));}else stopPlayback(true);return;}requestAnimationFrame(tick);}

  // Circular knobs: drag vertically, tap + arrows/keyboard for fine control.
  document.querySelectorAll('.knob-dial').forEach(d=>{
    const input=$(d.dataset.for);if(!input)return;let startY=0,startValue=0;
    const set=v=>{const min=Number(input.min),max=Number(input.max),step=Number(input.step||1);let nv=Math.max(min,Math.min(max,v));nv=Math.round(nv/step)*step;input.value=nv;input.dispatchEvent(new Event('input',{bubbles:true}));};
    d.addEventListener('pointerdown',e=>{startY=e.clientY;startValue=Number(input.value);d.setPointerCapture?.(e.pointerId)});
    d.addEventListener('pointermove',e=>{if(!d.hasPointerCapture?.(e.pointerId))return;const range=Number(input.max)-Number(input.min);set(startValue-(e.clientY-startY)*range/180)});
    d.addEventListener('pointerup',()=>{});
    d.addEventListener('keydown',e=>{const step=Number(input.step||1);if(e.key==='ArrowUp'||e.key==='ArrowRight'){set(Number(input.value)+step);e.preventDefault()}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){set(Number(input.value)-step);e.preventDefault()}});
  });
  document.querySelectorAll('input[type=range]').forEach(i=>i.addEventListener('input',()=>{updateChain(state.micChain);updateOutputs();}));
  document.querySelectorAll('[data-mute]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.mute;state.muted[t]=!state.muted[t];b.style.background=state.muted[t]?'#6d2732':''}));
  document.querySelectorAll('[data-solo]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.solo;state.solo[t]=!state.solo[t];b.style.background=state.solo[t]?'#765f1b':''}));

  const presets={
    'Clean Vocal':{gain:1,noiseReduce:75,gate:-55,low:0,mid:1,high:3,comp:2.5,sat:0,delay:0,reverb:8,tune:15,human:75},
    'Modern Pop':{gain:1,noiseReduce:70,gate:-55,low:-1,mid:2,high:5,comp:4,sat:12,delay:12,reverb:18,tune:55,human:35},
    'Afro Vocal':{gain:1,noiseReduce:72,gate:-56,low:2,mid:1,high:3,comp:3,sat:8,delay:18,reverb:14,tune:35,human:60},
    'Warm R&B':{gain:1,noiseReduce:70,gate:-55,low:3,mid:-1,high:-1,comp:3,sat:15,delay:10,reverb:22,tune:25,human:80},
    'Telephone':{gain:1,noiseReduce:80,gate:-58,low:-18,mid:6,high:-12,comp:5,sat:5,delay:0,reverb:0,tune:0,human:100},
    'Bright Lead':{gain:1,noiseReduce:65,gate:-55,low:-1,mid:2,high:8,comp:3.5,sat:5,delay:8,reverb:12,tune:45,human:45},
    'Wide Delay':{gain:1,noiseReduce:70,gate:-55,low:0,mid:0,high:2,comp:2,sat:4,delay:35,reverb:25,tune:15,human:65},
    'Vocal Air':{gain:1,noiseReduce:65,gate:-55,low:0,mid:0,high:10,comp:3,sat:2,delay:5,reverb:12,tune:20,human:80},
    'Dark Rap':{gain:1.02,noiseReduce:75,gate:-53,low:5,mid:2,high:-5,comp:5,sat:10,delay:6,reverb:6,tune:20,human:70}
  };
  $('applyPreset')?.addEventListener('click',()=>{const p=presets[$('preset').value];if(!p)return;Object.entries(p).forEach(([k,v])=>{if($(k))$(k).value=v});updateChain(state.micChain);analyzePitch();$('aiStatus').textContent=$('preset').value+' preset applied.'});

  function addAutomation(){const s=Number($('autoStart').value||0),e=Number($('autoEnd').value||0);if(e<=s){$('aiStatus').textContent='Automation end must be after start.';return}state.automations.push({p:$('autoParam').value,s,e,f:Number($('autoFrom').value),t:Number($('autoTo').value)});renderAutomations();}
  $('addAuto')?.addEventListener('click',addAutomation);function renderAutomations(){$('autoList').innerHTML=state.automations.map((a,i)=>`<div class="automation-item">${a.p}: ${a.s}s → ${a.e}s | ${a.f} → ${a.t}<button data-remove-auto="${i}">remove</button></div>`).join('');$('autoList').querySelectorAll('[data-remove-auto]').forEach(b=>b.onclick=()=>{state.automations.splice(Number(b.dataset.removeAuto),1);renderAutomations()})}
  function applyAutomation(t){state.automations.forEach(a=>{if(t<a.s||t>a.e)return;const el=$(a.p);if(!el)return;el.value=a.f+(a.t-a.f)*(t-a.s)/Math.max(.001,a.e-a.s);el.dispatchEvent(new Event('input',{bubbles:true}))})}

  function noteIndex(n){return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(n)}
  function nearestScalePitch(midi,key,scale){const root=noteIndex(key),allowed=scale==='Chromatic'?[0,1,2,3,4,5,6,7,8,9,10,11]:scale==='Major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];let best=midi,bestD=99;for(let d=-12;d<=12;d++){const m=midi+d,pc=((m%12)+12)%12,rel=(pc-root+12)%12;if(allowed.includes(rel)&&Math.abs(d)<bestD){best=m;bestD=Math.abs(d)}}return best}
  function estimatePitch(buffer){const data=buffer.getChannelData(0),sr=buffer.sampleRate,minLag=Math.floor(sr/900),maxLag=Math.floor(sr/70),win=Math.min(Math.floor(sr*.035),data.length),hop=Math.max(1,Math.floor(sr*.25));let sum=0,count=0;for(let start=0;start+maxLag+win<data.length;start+=hop){let bestLag=minLag,best=-1;for(let lag=minLag;lag<=maxLag;lag+=2){let corr=0,en=0;for(let i=0;i<win;i+=4){const a=data[start+i],b=data[start+i+lag];corr+=a*b;en+=a*a+b*b}const sc=en?corr/en:0;if(sc>best){best=sc;bestLag=lag}}if(best>.08){sum+=sr/bestLag;count++}}return count?sum/count:null}
  function analyzePitch(){if(!state.vocal)return;const f=estimatePitch(state.vocal);if(!f){state.currentPitchRatio=1;state.currentPitchSemitones=0;$('pitchInfo').textContent='Pitch engine: no stable vocal pitch detected.';return}const midi=69+12*Math.log2(f/440),target=nearestScalePitch(Math.round(midi),$('key').value,$('scale').value),strength=Number($('tune').value)/100,human=Number($('human').value)/100;state.currentPitchSemitones=(target-midi)*strength*(1-human);state.currentPitchRatio=Math.pow(2,state.currentPitchSemitones/12);$('pitchInfo').textContent=`Detected ${f.toFixed(1)} Hz • target MIDI ${target.toFixed(0)} • correction ${state.currentPitchSemitones.toFixed(2)} semitones. This preview shifts the vocal globally; true note-by-note Auto-Tune needs a dedicated pitch/time engine.`}
  ['tune','human','key','scale'].forEach(id=>$(id)?.addEventListener('input',analyzePitch));

  $('runAI')?.addEventListener('click',()=>{const text=String($('ai').value||'').toLowerCase(),applied=[];const pct=(re,id)=>{const m=text.match(re);if(!m)return false;$(id).value=Math.max(0,Math.min(100,Number(m[1])));return true};if(text.includes('bright')){$('high').value=6;applied.push('high EQ +6 dB')}if(text.includes('warm')){$('low').value=3;$('high').value=-2;applied.push('warm EQ')}if(text.includes('compress')){$('comp').value=4;applied.push('4:1 compression')}if(text.includes('echo')||text.includes('delay')){pct(/(?:echo|delay)\s*(?:to|at)?\s*(\d{1,3})%/,'delay');if(Number($('delay').value)===0)$('delay').value=25;applied.push('echo '+$('delay').value+'%')}if(text.includes('reverb')){pct(/reverb\s*(?:to|at)?\s*(\d{1,3})%/,'reverb');if(Number($('reverb').value)===0)$('reverb').value=20;applied.push('reverb '+$('reverb').value+'%')}if(text.includes('saturation')){pct(/saturation\s*(?:to|at)?\s*(\d{1,3})%/,'sat');if(Number($('sat').value)===0)$('sat').value=12;applied.push('saturation '+$('sat').value+'%')}if(text.includes('noise')||text.includes('fan')||text.includes('clean')){$('noiseReduce').value=85;$('gate').value=-48;applied.push('strong noise reduction')}if(text.includes('human')){pct(/human(?:ize)?\s*(?:to|at)?\s*(\d{1,3})%/,'human');if(Number($('human').value)===0)$('human').value=60;applied.push('humanize '+$('human').value+'%')}if(text.includes('tune')||text.includes('auto-tune')||text.includes('autotune')){pct(/(?:auto[- ]?tune|tune)\s*(?:to|at)?\s*(\d{1,3})%/,'tune');if(Number($('tune').value)===0)$('tune').value=70;applied.push('pitch correction '+$('tune').value+'%')}updateChain(state.micChain);analyzePitch();$('aiStatus').textContent=applied.length?'Applied: '+applied.join(', '):'No matching command.'});

  async function startRecording(){
    await ensureMic();if(!state.micRecordDest)throw new Error('Microphone recording path is unavailable');if(!window.MediaRecorder)throw new Error('MediaRecorder is not supported');
    const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t))||'';
    state.recordChunks=[];state.recorder=mime?new MediaRecorder(state.micRecordDest.stream,{mimeType:mime}):new MediaRecorder(state.micRecordDest.stream);
    state.recorder.ondataavailable=e=>{if(e.data?.size)state.recordChunks.push(e.data)};
    state.recorder.onstop=async()=>{try{const blob=new Blob(state.recordChunks,{type:state.recorder.mimeType||'audio/webm'}),ab=await blob.arrayBuffer(),c=await resumeAudio();state.vocal=await c.decodeAudioData(ab.slice(0));$('vocalState').textContent='Recorded cleaned take ('+state.vocal.duration.toFixed(1)+'s)';$('vocalClip').style.width=Math.max(28,Math.min(92,state.vocal.duration/60*100))+'%';analyzePitch();status('Take captured and cleaned.')}catch(e){status('Could not decode take: '+e.message)}};
    state.recorder.start(250);state.recording=true;$('record').textContent='■ Stop Recording';status('Recording… fan/room reduction active.');
    if((state.beat||state.beatMedia)&&$('beatMonitor').checked&&!state.playing){state.offset=0;await startPlayback();}
  }
  $('record')?.addEventListener('click',async()=>{try{if(state.recording){state.recording=false;state.recorder?.stop();$('record').textContent='● Record';status('Finishing take…')}else await startRecording()}catch(e){state.recording=false;$('record').textContent='● Record';status('Recording error: '+e.message)}});

  function renderOfflineChain(off,input,master){const out=off.createGain();out.gain.value=Number($('gain').value);const hp=off.createBiquadFilter();hp.type='highpass';hp.frequency.value=75;const lo=off.createBiquadFilter();lo.type='lowshelf';lo.frequency.value=120;lo.gain.value=Number($('low').value);const mi=off.createBiquadFilter();mi.type='peaking';mi.frequency.value=1200;mi.Q.value=1;mi.gain.value=Number($('mid').value);const hi=off.createBiquadFilter();hi.type='highshelf';hi.frequency.value=6500;hi.gain.value=Number($('high').value);const co=off.createDynamicsCompressor();co.threshold.value=-18;co.knee.value=18;co.ratio.value=Math.max(1,Number($('comp').value));co.attack.value=.005;co.release.value=.12;const sh=off.createWaveShaper();sh.curve=makeCurve(Number($('sat').value)/22);sh.oversample='2x';const d=off.createDelay(2),dg=off.createGain();d.delayTime.value=.18+(Number($('delay').value)/80)*.42;dg.gain.value=Number($('delay').value)/100;const rv=off.createConvolver();rv.buffer=makeImpulse(off);const rg=off.createGain();rg.gain.value=Number($('reverb').value)/100;input.connect(hp).connect(out).connect(lo).connect(mi).connect(hi).connect(co).connect(sh).connect(master);sh.connect(d).connect(dg).connect(master);sh.connect(rv).connect(rg).connect(master)}
  async function renderMix(){if(!state.beat&&!state.vocal)throw new Error('Load or record audio first');if(state.beatMedia)throw new Error('This MP4 beat is in browser media mode. For WAV export, use a browser-decodable MP4 or import WAV/MP3.');const c=await resumeAudio(),dur=Math.max(state.beat?.duration||0,state.vocal?.duration||0,1),off=new OfflineAudioContext(2,Math.ceil(dur*c.sampleRate),c.sampleRate),master=off.createGain();master.gain.value=Number($('master').value)/100;master.connect(off.destination);if(state.beat&&allowed('beat')){const s=off.createBufferSource();s.buffer=state.beat;s.connect(master);s.start()}if(state.vocal&&allowed('vocal')){const s=off.createBufferSource();s.buffer=state.vocal;s.playbackRate.value=state.currentPitchRatio;const inp=off.createGain();s.connect(inp);renderOfflineChain(off,inp,master);s.start()}return off.startRendering()}
  function wav(buffer){const ch=buffer.numberOfChannels,len=buffer.length,out=new ArrayBuffer(44+len*ch*2),v=new DataView(out),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};w(0,'RIFF');v.setUint32(4,36+len*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,len*ch*2,true);let p=44;for(let i=0;i<len;i++)for(let c=0;c<ch;c++){const x=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return new Blob([out],{type:'audio/wav'})}
  $('export')?.addEventListener('click',async()=>{if(!state.beat&&!state.vocal){$('aiStatus').textContent='Import or record audio first.';return}$('aiStatus').textContent='Rendering mix…';try{const r=await renderMix(),u=URL.createObjectURL(wav(r));$('download').href=u;$('download').download='musiclab_mix.wav';$('download').hidden=false;$('aiStatus').textContent='Render complete.'}catch(e){$('aiStatus').textContent='Render failed: '+e.message}});
  setInterval(()=>{if(state.playing&&state.ctx){applyAutomation(state.ctx.currentTime-state.startedAt);$('meterFill').style.width=Math.min(100,35+Math.random()*45)+'%'}},80);
  updateOutputs();
})();
