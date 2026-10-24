/* MUSICLAB DAW v3.2 - core engine fix
   Browser DAW engine for index.html. No external libraries required.
*/
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = {
    ctx: null,
    beat: null,
    vocal: null,
    micStream: null,
    micSource: null,
    micMonitorGain: null,
    micChain: null,
    beatSource: null,
    vocalSource: null,
    beatGain: null,
    vocalGain: null,
    recorder: null,
    recordChunks: [],
    recording: false,
    playing: false,
    startedAt: 0,
    offset: 0,
    loop: false,
    muted: { beat: false, vocal: false },
    solo: { beat: false, vocal: false },
    automations: [],
    currentPitchRatio: 1,
    currentPitchSemitones: 0
  };

  const db = v => Math.pow(10, v / 20);

  function audio() {
    if (!state.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not supported by this browser');
      state.ctx = new AC();
    }
    return state.ctx;
  }

  async function resumeAudio() {
    const c = audio();
    if (c.state === 'suspended') await c.resume();
    return c;
  }

  function setStatus(text) {
    if ($('recordState')) $('recordState').textContent = text;
  }

  function makeImpulse(ctx, seconds = 1.8, decay = 2.5) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  function makeCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    const a = Math.max(0, Number(amount) || 0);
    for (let i = 0; i < n; i++) {
      const x = i * 2 / n - 1;
      curve[i] = (1 + a) * x / (1 + a * Math.abs(x));
    }
    return curve;
  }

  function createFXChain(ctx, input, output, options = {}) {
    const gate = ctx.createDynamicsCompressor();
    gate.threshold.value = Number($('gate')?.value ?? -55);
    gate.knee.value = 20;
    gate.ratio.value = 20;
    gate.attack.value = 0.003;
    gate.release.value = 0.15;

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 120;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 1;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 6500;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 18;
    comp.ratio.value = Number($('comp')?.value ?? 3);
    comp.attack.value = 0.005; comp.release.value = 0.12;

    const shaper = ctx.createWaveShaper();
    shaper.oversample = '2x';
    const gain = ctx.createGain();
    const delay = ctx.createDelay(2);
    const delayGain = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx);
    const reverbGain = ctx.createGain();

    input.connect(gate).connect(low).connect(mid).connect(high).connect(comp).connect(shaper).connect(gain);
    gain.connect(output);
    shaper.connect(delay).connect(delayGain).connect(output);
    shaper.connect(reverb).connect(reverbGain).connect(output);

    const chain = { gate, low, mid, high, comp, shaper, gain, delay, delayGain, reverb, reverbGain, output };
    updateChain(chain);
    return chain;
  }

  function updateChain(chain) {
    if (!chain) return;
    const val = id => Number($(id)?.value ?? 0);
    chain.gain.gain.value = val('gain');
    chain.gate.threshold.value = val('gate');
    chain.low.gain.value = val('low');
    chain.mid.gain.value = val('mid');
    chain.high.gain.value = val('high');
    chain.comp.ratio.value = Math.max(1, val('comp'));
    chain.shaper.curve = makeCurve(val('sat') / 22);
    chain.delayGain.gain.value = Math.max(0, val('delay') / 100);
    chain.delay.delayTime.value = Math.min(1.2, 0.18 + (val('delay') / 80) * 0.42);
    chain.reverbGain.gain.value = Math.max(0, val('reverb') / 100);
    updateOutputs();
  }

  function updateOutputs() {
    const labels = {
      gain: '', gate: ' dB', low: ' dB', mid: ' dB', high: ' dB', comp: ':1',
      sat: '%', delay: '%', reverb: '%', tune: '%', human: '%', master: '%'
    };
    ['gain','gate','low','mid','high','comp','sat','delay','reverb','tune','human','master'].forEach(k => {
      const out = $(k + 'Out');
      const input = $(k);
      if (out && input) out.textContent = input.value + (labels[k] || '');
    });
  }

  async function loadFile(file, type) {
    if (!file) return;
    const c = await resumeAudio();
    const data = await file.arrayBuffer();
    const buffer = await c.decodeAudioData(data.slice(0));
    if (type === 'beat') {
      state.beat = buffer;
      if ($('beatState')) $('beatState').textContent = `${file.name} • ${buffer.duration.toFixed(1)}s`;
      if ($('beatClip')) $('beatClip').style.width = Math.max(28, Math.min(92, buffer.duration / 60 * 100)) + '%';
    } else {
      state.vocal = buffer;
      if ($('vocalState')) $('vocalState').textContent = `${file.name} • ${buffer.duration.toFixed(1)}s`;
      if ($('vocalClip')) $('vocalClip').style.width = Math.max(28, Math.min(92, buffer.duration / 60 * 100)) + '%';
      analyzePitch();
    }
    setStatus(`${type === 'beat' ? 'Beat' : 'Vocal'} loaded.`);
  }

  $('beatBtn')?.addEventListener('click', () => $('beatFile')?.click());
  $('vocalBtn')?.addEventListener('click', () => $('vocalFile')?.click());
  $('beatFile')?.addEventListener('change', e => loadFile(e.target.files?.[0], 'beat').catch(e => setStatus('Beat error: ' + e.message)));
  $('vocalFile')?.addEventListener('change', e => loadFile(e.target.files?.[0], 'vocal').catch(e => setStatus('Vocal error: ' + e.message)));

  async function ensureMic() {
    const c = await resumeAudio();
    if (state.micStream && state.micSource) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone API unavailable. Use Chrome/Edge over HTTPS.');

    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    });
    state.micSource = c.createMediaStreamSource(state.micStream);
    state.micMonitorGain = c.createGain();
    state.micMonitorGain.gain.value = $('monitor')?.checked ? 1 : 0;
    state.micChain = createFXChain(c, state.micSource, state.micMonitorGain);
    state.micMonitorGain.connect(c.destination);

    if ($('mic')) $('mic').textContent = '🎙 Mic enabled';
    setStatus('Mic ready — headphones recommended');
  }

  function disableMic() {
    if (state.micStream) state.micStream.getTracks().forEach(t => t.stop());
    state.micStream = null;
    try { state.micSource?.disconnect(); } catch (_) {}
    state.micSource = null;
    state.micMonitorGain = null;
    state.micChain = null;
    if ($('mic')) $('mic').textContent = '🎙 Enable Mic';
    setStatus('Mic off');
  }

  $('mic')?.addEventListener('click', async () => {
    try {
      if (state.micStream) disableMic();
      else await ensureMic();
    } catch (e) {
      setStatus('Mic error: ' + (e?.message || e));
    }
  });

  $('monitor')?.addEventListener('change', () => {
    if (state.micMonitorGain) state.micMonitorGain.gain.value = $('monitor').checked ? 1 : 0;
  });

  function allowed(track) {
    if (state.solo.beat || state.solo.vocal) return !!state.solo[track];
    return !state.muted[track];
  }

  function stopSource(source) {
    if (!source) return;
    try { source.stop(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
  }

  function stopSources() {
    stopSource(state.beatSource); stopSource(state.vocalSource);
    state.beatSource = null; state.vocalSource = null;
    state.beatGain = null; state.vocalGain = null;
  }

  function stopPlayback(resetOffset = false) {
    if (state.playing && state.ctx) {
      state.offset = Math.max(0, state.ctx.currentTime - state.startedAt);
    }
    stopSources();
    state.playing = false;
    if (resetOffset) state.offset = 0;
    if ($('play')) $('play').textContent = '▶ Play';
  }

  async function startPlayback() {
    const c = await resumeAudio();
    if (state.playing) return;
    if (!state.beat && !state.vocal) { setStatus('Load a beat or vocal first.'); return; }

    const now = c.currentTime;
    const master = c.createGain();
    master.gain.value = Number($('master')?.value ?? 100) / 100;
    master.connect(c.destination);

    if (state.beat && allowed('beat') && $('beatMonitor')?.checked) {
      state.beatSource = c.createBufferSource();
      state.beatSource.buffer = state.beat;
      state.beatGain = c.createGain();
      state.beatGain.gain.value = 1;
      state.beatSource.connect(state.beatGain).connect(master);
      const off = Math.min(state.offset, Math.max(0, state.beat.duration - 0.001));
      state.beatSource.start(now, off);
    }

    if (state.vocal && allowed('vocal')) {
      state.vocalSource = c.createBufferSource();
      state.vocalSource.buffer = state.vocal;
      state.vocalSource.playbackRate.value = state.currentPitchRatio;
      state.vocalGain = c.createGain();
      state.vocalGain.gain.value = 1;
      state.vocalSource.connect(state.vocalGain);
      createFXChain(c, state.vocalGain, master);
      const off = Math.min(state.offset, Math.max(0, state.vocal.duration - 0.001));
      state.vocalSource.start(now, off);
    }

    state.startedAt = now - state.offset;
    state.playing = true;
    if ($('play')) $('play').textContent = '❚❚ Pause';
    tick();
  }

  $('play')?.addEventListener('click', () => {
    if (state.playing) stopPlayback(false);
    else startPlayback().catch(e => setStatus('Playback error: ' + e.message));
  });
  $('stop')?.addEventListener('click', () => stopPlayback(true));
  $('loop')?.addEventListener('click', () => {
    state.loop = !state.loop;
    if ($('loop')) $('loop').style.borderColor = state.loop ? '#72a9ff' : '';
  });

  function tick() {
    if (!state.playing || !state.ctx) return;
    const t = Math.max(0, state.ctx.currentTime - state.startedAt);
    if ($('time')) $('time').textContent = new Date(t * 1000).toISOString().substr(14, 5) + '.' + Math.floor((t % 1) * 10);
    const duration = Math.max(state.beat?.duration || 0, state.vocal?.duration || 0);
    if (duration && t >= duration) {
      if (state.loop) {
        stopPlayback(true);
        startPlayback().catch(e => setStatus('Loop error: ' + e.message));
      } else {
        stopPlayback(true);
      }
      return;
    }
    requestAnimationFrame(tick);
  }

  document.querySelectorAll('input[type=range]').forEach(input => input.addEventListener('input', () => {
    updateChain(state.micChain);
    updateOutputs();
  }));

  document.querySelectorAll('[data-mute]').forEach(button => button.addEventListener('click', () => {
    const track = button.dataset.mute;
    state.muted[track] = !state.muted[track];
    button.style.background = state.muted[track] ? '#6d2732' : '';
  }));
  document.querySelectorAll('[data-solo]').forEach(button => button.addEventListener('click', () => {
    const track = button.dataset.solo;
    state.solo[track] = !state.solo[track];
    button.style.background = state.solo[track] ? '#765f1b' : '';
  }));

  const presets = {
    'Clean Vocal': {gain:1,gate:-55,low:0,mid:1,high:3,comp:2.5,sat:0,delay:0,reverb:8,tune:15,human:75},
    'Modern Pop': {gain:1,gate:-55,low:-1,mid:2,high:5,comp:4,sat:12,delay:12,reverb:18,tune:55,human:35},
    'Afro Vocal': {gain:1,gate:-56,low:2,mid:1,high:3,comp:3,sat:8,delay:18,reverb:14,tune:35,human:60},
    'Warm R&B': {gain:1,gate:-55,low:3,mid:-1,high:-1,comp:3,sat:15,delay:10,reverb:22,tune:25,human:80},
    'Telephone': {gain:1,gate:-58,low:-18,mid:6,high:-12,comp:5,sat:5,delay:0,reverb:0,tune:0,human:100},
    'Bright Lead': {gain:1,gate:-55,low:-1,mid:2,high:8,comp:3.5,sat:5,delay:8,reverb:12,tune:45,human:45},
    'Wide Delay': {gain:1,gate:-55,low:0,mid:0,high:2,comp:2,sat:4,delay:35,reverb:25,tune:15,human:65},
    'Vocal Air': {gain:1,gate:-55,low:0,mid:0,high:10,comp:3,sat:2,delay:5,reverb:12,tune:20,human:80},
    'Dark Rap': {gain:1.02,gate:-53,low:5,mid:2,high:-5,comp:5,sat:10,delay:6,reverb:6,tune:20,human:70}
  };

  $('applyPreset')?.addEventListener('click', () => {
    const p = presets[$('preset')?.value];
    if (!p) return;
    Object.entries(p).forEach(([k,v]) => { if ($(k)) $(k).value = v; });
    updateChain(state.micChain); analyzePitch();
    if ($('aiStatus')) $('aiStatus').textContent = $('preset').value + ' preset applied.';
  });

  function addAutomation() {
    const s = Number($('autoStart')?.value || 0), e = Number($('autoEnd')?.value || 0);
    if (e <= s) { if ($('aiStatus')) $('aiStatus').textContent = 'Automation end must be after start.'; return; }
    state.automations.push({ p:$('autoParam').value, s, e, f:Number($('autoFrom').value), t:Number($('autoTo').value) });
    renderAutomations();
  }
  $('addAuto')?.addEventListener('click', addAutomation);
  function renderAutomations() {
    if (!$('autoList')) return;
    $('autoList').innerHTML = state.automations.map((a,i) =>
      `<div class="automation-item">${a.p}: ${a.s}s → ${a.e}s | ${a.f} → ${a.t}<button data-remove-auto="${i}">remove</button></div>`
    ).join('');
    $('autoList').querySelectorAll('[data-remove-auto]').forEach(b => b.addEventListener('click', () => {
      state.automations.splice(Number(b.dataset.removeAuto), 1); renderAutomations();
    }));
  }

  function applyAutomation(time) {
    state.automations.forEach(a => {
      if (time < a.s || time > a.e) return;
      const el = $(a.p); if (!el) return;
      el.value = a.f + (a.t - a.f) * ((time - a.s) / Math.max(0.001, a.e - a.s));
      updateChain(state.micChain); updateOutputs();
    });
  }

  function noteIndex(name) { return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(name); }
  function nearestScalePitch(midi, key, scale) {
    const root = noteIndex(key);
    const allowed = scale === 'Chromatic' ? [0,1,2,3,4,5,6,7,8,9,10,11] : scale === 'Major' ? [0,2,4,5,7,9,11] : [0,2,3,5,7,8,10];
    let best = midi, bestD = Infinity;
    for (let d=-12; d<=12; d++) {
      const m=midi+d, pc=((m%12)+12)%12, rel=(pc-root+12)%12;
      if (allowed.includes(rel) && Math.abs(d)<bestD) { best=m; bestD=Math.abs(d); }
    }
    return best;
  }

  function estimatePitch(buffer) {
    const data = buffer.getChannelData(0), sr = buffer.sampleRate;
    const minLag = Math.floor(sr / 900), maxLag = Math.floor(sr / 70);
    const window = Math.min(Math.floor(sr * 0.035), data.length);
    const hop = Math.max(1, Math.floor(sr * 0.25));
    let sum=0,count=0;
    for (let start=0; start+maxLag+window<data.length; start+=hop) {
      let bestLag=minLag,best=-Infinity;
      for (let lag=minLag; lag<=maxLag; lag+=2) {
        let corr=0,energy=0;
        for (let i=0;i<window;i+=4) {
          const a=data[start+i], b=data[start+i+lag];
          corr += a*b; energy += a*a+b*b;
        }
        const score=energy?corr/energy:0;
        if(score>best){best=score;bestLag=lag;}
      }
      if(best>0.08){sum += sr/bestLag; count++;}
    }
    return count ? sum/count : null;
  }

  function analyzePitch() {
    if (!state.vocal) return;
    const f = estimatePitch(state.vocal);
    if (!f) {
      state.currentPitchRatio=1; state.currentPitchSemitones=0;
      if ($('pitchInfo')) $('pitchInfo').textContent='Pitch engine: no stable vocal pitch detected.';
      return;
    }
    const midi=69+12*Math.log2(f/440);
    const target=nearestScalePitch(Math.round(midi), $('key')?.value || 'C', $('scale')?.value || 'Chromatic');
    const strength=Number($('tune')?.value || 0)/100;
    const human=Number($('human')?.value || 0)/100;
    const effective=strength*(1-human);
    state.currentPitchSemitones=(target-midi)*effective;
    state.currentPitchRatio=Math.pow(2,state.currentPitchSemitones/12);
    if ($('pitchInfo')) $('pitchInfo').textContent=`Detected average ${f.toFixed(1)} Hz • target ${target.toFixed(0)} MIDI • correction ${state.currentPitchSemitones.toFixed(2)} semitones.`;
  }
  ['tune','human','key','scale'].forEach(id => $(id)?.addEventListener('input', analyzePitch));

  $('runAI')?.addEventListener('click', () => {
    const text = String($('ai')?.value || '').toLowerCase();
    const applied=[];
    const percent = (regex, id) => {
      const m=text.match(regex); if(!m) return false;
      $(id).value=Math.max(0,Math.min(100,Number(m[1]))); return true;
    };
    if(text.includes('bright')){$('high').value=6;applied.push('high EQ +6 dB');}
    if(text.includes('warm')){$('low').value=3;$('high').value=-2;applied.push('warm EQ');}
    if(text.includes('dark')){$('high').value=-5;applied.push('high EQ -5 dB');}
    if(text.includes('compress')){$('comp').value=4;applied.push('4:1 compression');}
    if(text.includes('echo')||text.includes('delay')){percent(/(?:echo|delay)\s*(?:to|at)?\s*(\d{1,3})%/, 'delay');if(Number($('delay').value)===0)$('delay').value=25;applied.push('echo '+$('delay').value+'%');}
    if(text.includes('reverb')){percent(/reverb\s*(?:to|at)?\s*(\d{1,3})%/, 'reverb');if(Number($('reverb').value)===0)$('reverb').value=20;applied.push('reverb '+$('reverb').value+'%');}
    if(text.includes('saturation')){percent(/saturation\s*(?:to|at)?\s*(\d{1,3})%/, 'sat');if(Number($('sat').value)===0)$('sat').value=12;applied.push('saturation '+$('sat').value+'%');}
    if(text.includes('noise')||text.includes('clean')){$('gate').value=-50;applied.push('noise gate -50 dB');}
    if(text.includes('human')){percent(/human(?:ize)?\s*(?:to|at)?\s*(\d{1,3})%/, 'human');if(Number($('human').value)===0)$('human').value=60;applied.push('humanize '+$('human').value+'%');}
    if(text.includes('tune')||text.includes('auto-tune')||text.includes('autotune')){percent(/(?:auto[- ]?tune|tune)\s*(?:to|at)?\s*(\d{1,3})%/, 'tune');if(Number($('tune').value)===0)$('tune').value=60;applied.push('pitch correction '+$('tune').value+'%');}
    if(text.includes('vocal louder')){$('gain').value=1.25;applied.push('vocal gain 1.25');}
    if(text.includes('vocal softer')){$('gain').value=.8;applied.push('vocal gain 0.8');}
    updateChain(state.micChain); analyzePitch();
    if ($('aiStatus')) $('aiStatus').textContent=applied.length?'Applied: '+applied.join(', '):'No matching command.';
  });

  async function startRecording() {
    await ensureMic();
    if (!state.micStream) throw new Error('Microphone is not available');
    const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
    const mime=types.find(t=>window.MediaRecorder?.isTypeSupported?.(t)) || '';
    if(!window.MediaRecorder) throw new Error('MediaRecorder is not supported by this browser');

    state.recordChunks=[];
    state.recorder = mime ? new MediaRecorder(state.micStream,{mimeType:mime}) : new MediaRecorder(state.micStream);
    state.recorder.ondataavailable=e=>{if(e.data?.size)state.recordChunks.push(e.data)};
    state.recorder.onerror=e=>setStatus('Recorder error: '+(e.error?.message||'unknown error'));
    state.recorder.onstop=async()=>{
      try {
        const blob=new Blob(state.recordChunks,{type:state.recorder.mimeType||'audio/webm'});
        const ab=await blob.arrayBuffer();
        const c=await resumeAudio();
        state.vocal=await c.decodeAudioData(ab.slice(0));
        if($('vocalState'))$('vocalState').textContent='Recorded take ('+state.vocal.duration.toFixed(1)+'s)';
        if($('vocalClip'))$('vocalClip').style.width=Math.max(28,Math.min(92,state.vocal.duration/60*100))+'%';
        analyzePitch(); setStatus('Take captured.');
      } catch(e) { setStatus('Could not decode take: '+e.message); }
    };
    state.recorder.start(250);
    state.recording=true;
    if($('record'))$('record').textContent='■ Stop Recording';
    setStatus('Recording…');

    // Start the beat only after recording has started. Do not toggle the mic.
    if(state.beat && $('beatMonitor')?.checked && !state.playing){
      state.offset=0;
      await startPlayback();
    }
  }

  $('record')?.addEventListener('click', async()=>{
    try {
      if(state.recording){
        state.recording=false;
        state.recorder?.stop();
        if($('record'))$('record').textContent='● Record';
        setStatus('Finishing take…');
      } else await startRecording();
    } catch(e) {
      state.recording=false;
      if($('record'))$('record').textContent='● Record';
      setStatus('Recording error: '+(e?.message||e));
    }
  });

  function renderOfflineChain(off,input,master){
    const out=off.createGain(); out.gain.value=Number($('gain')?.value||1);
    const lo=off.createBiquadFilter();lo.type='lowshelf';lo.frequency.value=120;lo.gain.value=Number($('low')?.value||0);
    const mi=off.createBiquadFilter();mi.type='peaking';mi.frequency.value=1200;mi.Q.value=1;mi.gain.value=Number($('mid')?.value||0);
    const hi=off.createBiquadFilter();hi.type='highshelf';hi.frequency.value=6500;hi.gain.value=Number($('high')?.value||0);
    const co=off.createDynamicsCompressor();co.threshold.value=-18;co.knee.value=18;co.ratio.value=Math.max(1,Number($('comp')?.value||3));co.attack.value=.005;co.release.value=.12;
    const sh=off.createWaveShaper();sh.curve=makeCurve(Number($('sat')?.value||0)/22);sh.oversample='2x';
    const delay=off.createDelay(2),dg=off.createGain();delay.delayTime.value=.18+(Number($('delay')?.value||0)/80)*.42;dg.gain.value=Number($('delay')?.value||0)/100;
    const rv=off.createConvolver();rv.buffer=makeImpulse(off);const rg=off.createGain();rg.gain.value=Number($('reverb')?.value||0)/100;
    input.connect(out).connect(lo).connect(mi).connect(hi).connect(co).connect(sh).connect(master);
    sh.connect(delay).connect(dg).connect(master);sh.connect(rv).connect(rg).connect(master);
  }

  async function renderMix(){
    if(!state.beat&&!state.vocal)throw new Error('Load or record audio first');
    const c=await resumeAudio();
    const dur=Math.max(state.beat?.duration||0,state.vocal?.duration||0,1);
    const off=new OfflineAudioContext(2,Math.ceil(dur*c.sampleRate),c.sampleRate);
    const master=off.createGain();master.gain.value=Number($('master')?.value||100)/100;master.connect(off.destination);
    if(state.beat&&allowed('beat')){const s=off.createBufferSource();s.buffer=state.beat;s.connect(master);s.start(0);}
    if(state.vocal&&allowed('vocal')){const s=off.createBufferSource();s.buffer=state.vocal;s.playbackRate.value=state.currentPitchRatio;const input=off.createGain();s.connect(input);renderOfflineChain(off,input,master);s.start(0);}
    return off.startRendering();
  }

  function wav(buffer){
    const ch=buffer.numberOfChannels,len=buffer.length,out=new ArrayBuffer(44+len*ch*2),view=new DataView(out);
    const write=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
    write(0,'RIFF');view.setUint32(4,36+len*ch*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,ch,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*ch*2,true);view.setUint16(32,ch*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,len*ch*2,true);
    let p=44;for(let i=0;i<len;i++)for(let c=0;c<ch;c++){const x=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));view.setInt16(p,x<0?x*32768:x*32767,true);p+=2;}
    return new Blob([out],{type:'audio/wav'});
  }

  $('export')?.addEventListener('click',async()=>{
    if(!state.beat&&!state.vocal){if($('aiStatus'))$('aiStatus').textContent='Import or record a beat/vocal first.';return;}
    if($('aiStatus'))$('aiStatus').textContent='Rendering mix…';
    try{const result=await renderMix();const url=URL.createObjectURL(wav(result));$('download').href=url;$('download').download='musiclab_mix.wav';$('download').hidden=false;if($('aiStatus'))$('aiStatus').textContent='Render complete.';}
    catch(e){if($('aiStatus'))$('aiStatus').textContent='Render failed: '+e.message;}
  });

  setInterval(()=>{
    if(state.playing&&state.ctx){applyAutomation(state.ctx.currentTime-state.startedAt);const v=Math.min(100,Number($('master')?.value||100));if($('meterFill'))$('meterFill').style.width=(Math.random()*v*.35+v*.45)+'%';}
  },80);

  updateOutputs();
})();
