// Runs with native OfflineAudioContext in Node and in both browser engines.
// Node's engine renders bit-identically; browsers may differ in float rounding between mono and stereo
// graphs, so callers pass a tolerance (1e-5 is -100 dBFS, far below audibility).
export async function compareCache(sfx: any, recipes: any, Offline: any, tolerance = 0): Promise<{ bytes: number; maxDiff: number }> {
  const originalRandom = Math.random;
  const originalRender = Offline.prototype.startRendering;
  let cached: AudioBuffer;
  Offline.prototype.startRendering = async function () {
    cached = await originalRender.call(this);
    return cached;
  };
  let bytes = 0;
  let maxDiff = 0;
  try {
    for (const name of sfx.sounds) {
      // Reset the noise stream for each independent render of the same recipe.
      const seedNoise = () => {
        let seed = 1;
        Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      };
      // Start each render from an empty engine (no cached noise samples) and the same random stream.
      await sfx.dispose();
      seedNoise();
      await sfx.preload([name]);
      const mono = cached!;
      bytes += mono.length * mono.numberOfChannels * 4;
      if (recipes[name].layers.some((layer: any) => layer.pan)) continue;
      if (mono.numberOfChannels !== 1) throw new Error(`Not mono: ${name}`);
      await sfx.dispose();
      seedNoise();
      const stereo = await sfx.renderBuffer(name, { sampleRate: 48000 });
      if (stereo.numberOfChannels !== 2) throw new Error(`Not stereo: ${name}`);
      for (const pan of [0, 0.3]) {
        const render = async (buffer: AudioBuffer) => {
          const ctx = new Offline(2, buffer.length, 48000);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          if (pan) {
            const panner = ctx.createStereoPanner();
            panner.channelCount = 2;
            panner.channelCountMode = 'explicit';
            panner.pan.value = pan;
            source.connect(panner).connect(ctx.destination);
          } else source.connect(ctx.destination);
          source.start();
          return originalRender.call(ctx);
        };
        const a = await render(mono), b = await render(stereo);
        for (let channel = 0; channel < 2; channel++) {
          const left = a.getChannelData(channel), right = b.getChannelData(channel);
          for (let i = 0; i < left.length; i++) {
            const diff = Math.abs(left[i] - right[i]);
            if (!(diff <= tolerance)) throw new Error(`${name}, pan ${pan}, channel ${channel}, sample ${i}: ${left[i]} != ${right[i]}`);
            if (diff > maxDiff) maxDiff = diff;
          }
        }
      }
    }
    return { bytes, maxDiff };
  } finally {
    Math.random = originalRandom;
    Offline.prototype.startRendering = originalRender;
    await sfx.dispose();
  }
}
