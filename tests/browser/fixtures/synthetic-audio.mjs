// Local simulation of VDO.Ninja's mute/volume message contract, not its transport.
// PCM is decoded by a real HTMLAudioElement. An analyser checks the media signal;
// the final gain stays at zero so these tests do not play sound on the computer.
function sineWaveDataUrl() {
  const sampleRate = 48_000;
  const samples = sampleRate * 2;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 8_000), 44 + index * 2);
  }
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

export const syntheticAudioFixture = `<!doctype html><html lang="de"><meta charset="utf-8">
<style>html,body{height:100%;margin:0;background:#101b29;color:white;font:16px system-ui}
body{display:grid;place-content:center;text-align:center}button{padding:16px}</style>
<body><p>Lokaler synthetischer Audiotest · kein Quest-Stream</p>
<button id="nativeAudioStart">Testplayer: Wiedergabe freigeben</button>
<audio id="testAudio" loop playsinline preload="auto"></audio>
<script>
const media = document.querySelector('#testAudio');
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;
const silentOutput = audioContext.createGain();
silentOutput.gain.value = 0;
audioContext.createMediaElementSource(media).connect(analyser);
analyser.connect(silentOutput).connect(audioContext.destination);
media.muted = new URL(location.href).searchParams.get('mutespeaker') !== '0';
media.volume = 1;
media.src = ${JSON.stringify(sineWaveDataUrl())};
const probe = window.audioProbe = {
  media, audioContext, attempts: 0, played: false, blocked: false,
  failures: [], muteMessages: 0, volumeMessages: 0, nativeStarts: 0,
  rms() {
    const values = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length);
  },
  snapshot() {
    return { muted: media.muted, volume: media.volume, paused: media.paused,
      currentTime: media.currentTime, readyState: media.readyState,
      contextState: audioContext.state, rms: this.rms(), played: this.played,
      blocked: this.blocked, failures: this.failures, attempts: this.attempts,
      muteMessages: this.muteMessages, volumeMessages: this.volumeMessages,
      nativeStarts: this.nativeStarts, outputGain: silentOutput.gain.value };
  }
};
function attemptPlayback() {
  probe.attempts++;
  audioContext.resume().catch(error => probe.failures.push(error.name));
  media.play().then(() => {
    probe.played = true;
    probe.blocked = false;
  }).catch(error => {
    probe.failures.push(error.name);
    probe.blocked = error.name === 'NotAllowedError';
  });
}
document.querySelector('#nativeAudioStart').addEventListener('click', () => {
  probe.nativeStarts++;
  attemptPlayback();
});
addEventListener('message', event => {
  if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
  if (typeof event.data.mute === 'boolean') {
    probe.muteMessages++;
    media.muted = event.data.mute;
    if (!media.muted) attemptPlayback();
  }
  if (typeof event.data.volume === 'number') {
    probe.volumeMessages++;
    media.volume = Math.max(0, Math.min(1, event.data.volume));
  }
  if (event.data.getStats) parent.postMessage({ cib: event.data.cib,
    stats: { inbound: { [new URL(location.href).searchParams.get('view')]: { _bytesReceived_video: 100 } } } }, '*');
});
attemptPlayback();
// Signal the simulated video connection independently from audio loading.
// Some WebKit media backends keep the frame load event pending until playback.
parent.postMessage({ action: 'new-video-track-added', value: true,
  streamID: new URL(location.href).searchParams.get('view') }, '*');
</script></body></html>`;
