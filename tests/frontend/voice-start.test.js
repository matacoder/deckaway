/** @jest-environment node */
const {boot,session,settle,routesFor}=require('./harness');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

async function microphone(){
  const audio={contexts:[],tracks:[]};
  const window=boot(routesFor({local:()=>({sessions:[session('alpha'),session('bravo')]})}),null,w=>{
    w.localStorage.setItem('cc.active','alpha');
    w.AudioContext=class{
      constructor(){this.sampleRate=48000;this.close=jest.fn(async()=>{});this.resume=async()=>{};audio.contexts.push(this)}
      createMediaStreamSource(){return {connect(){},disconnect(){}}}
      createScriptProcessor(){return {connect(){},disconnect(){}}}
    };
    Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:jest.fn(async()=>audio.stream())}});
  });
  audio.stream=()=>{
    const track={stop:jest.fn()};audio.tracks.push(track);
    return {getTracks:()=>[track],getAudioTracks:()=>[track]};
  };
  await settle();await settle();
  window.runVoice=jest.fn();
  return {window,audio};
}

test('repeated taps during engine lookup and microphone permission start only one recording',async()=>{
  const {window,audio}=await microphone(),engine=deferred(),permission=deferred();
  try{
    window.voiceEngine=jest.fn(()=>engine.promise);
    window.navigator.mediaDevices.getUserMedia.mockImplementation(()=>permission.promise);
    const first=window.eval('toggleVoice()');await window.eval('toggleVoice()');
    expect(audio.contexts).toHaveLength(1);expect(window.voiceEngine).toHaveBeenCalledTimes(1);
    engine.resolve('');await settle();await window.eval('toggleVoice()');
    expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    permission.resolve(audio.stream());await first;
    expect(window.eval('voice.rec.session')).toBe('alpha');expect(window.eval('voice.starting')).toBeNull();
    await window.eval('toggleVoice()');
    expect(window.eval('voice.rec')).toBeNull();
    expect(audio.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
  }finally{engine.resolve(null);permission.resolve(audio.stream());window.eval('stopVoice()');await settle();window.close()}
});

for(const cancel of ['session','stop'])test(`a cancelled microphone start releases its stream and allows retry (${cancel})`,async()=>{
  const {window,audio}=await microphone(),permission=deferred();
  try{
    window.voiceEngine=async()=>'';
    window.navigator.mediaDevices.getUserMedia.mockImplementationOnce(()=>permission.promise);
    const first=window.eval('toggleVoice()');await settle();
    window.eval(cancel==='session'?'select("bravo")':'stopVoice()');
    permission.resolve(audio.stream());await first;
    expect(window.eval('voice.rec')).toBeNull();expect(window.eval('voice.starting')).toBeNull();
    expect(audio.tracks[0].stop).toHaveBeenCalledTimes(1);expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    await window.eval('toggleVoice()');
    expect(window.eval('voice.rec')).not.toBeNull();window.eval('stopVoice()');
    expect(audio.tracks.every(track=>track.stop.mock.calls.length===1)).toBe(true);
  }finally{permission.resolve(audio.stream());window.eval('stopVoice()');await settle();window.close()}
});

test('denied microphone permission releases the start lock and audio context',async()=>{
  const {window,audio}=await microphone();
  try{
    window.voiceEngine=async()=>'';
    window.navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('Denied'));
    await window.eval('toggleVoice()');
    expect(window.eval('voice.starting')).toBeNull();expect(window.eval('voice.rec')).toBeNull();
    expect(audio.contexts[0].close).toHaveBeenCalledTimes(1);
    await window.eval('toggleVoice()');expect(window.eval('voice.rec')).not.toBeNull();
    window.eval('stopVoice()');expect(audio.tracks[0].stop).toHaveBeenCalledTimes(1);
  }finally{window.eval('stopVoice()');await settle();window.close()}
});
