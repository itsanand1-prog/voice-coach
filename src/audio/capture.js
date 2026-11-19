// Browser capture: microphone (or a synthetic source for the self-test) -> worklet -> FrameAnalyzer.
// Raw audio is never stored; samples are analysed and dropped.

import { FrameAnalyzer } from '../analyzer.js';

// DESIGN.md section 6: all browser voice processing off, so levels and onsets are real.
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

async function openPipeline(onFrames) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
  const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1 });
  const analyzer = new FrameAnalyzer(ctx.sampleRate);
  node.port.onmessage = (e) => {
    if (analyzer.push(e.data) > 0) onFrames(analyzer.track);
  };
  // Silent path to the destination keeps the graph pulling without playing the mic back.
  const mute = new GainNode(ctx, { gain: 0 });
  node.connect(mute).connect(ctx.destination);
  return { ctx, node, analyzer };
}

/** Start microphone capture. Resolves to {track, sampleRate, applied, warnings, stop()}. */
export async function startMic(onFrames) {
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  const { ctx, node, analyzer } = await openPipeline(onFrames);
  ctx.createMediaStreamSource(stream).connect(node);

  const applied = stream.getAudioTracks()[0].getSettings();
  const warnings = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
    .filter((k) => applied[k] === true)
    .map((k) => `${k} could not be turned off on this device; loudness and onset metrics may be distorted.`);

  return {
    track: analyzer.track,
    sampleRate: ctx.sampleRate,
    applied,
    warnings,
    async stop() {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

/**
 * Same interface as startMic, fed by a synthetic source instead of the microphone.
 * Used by the app's demo mode so the whole session flow can be checked without speaking.
 */
export async function startSynthetic(build, onFrames) {
  const { ctx, node, analyzer } = await openPipeline(onFrames);
  build(ctx).connect(node);
  return {
    track: analyzer.track,
    sampleRate: ctx.sampleRate,
    applied: {},
    warnings: [],
    async stop() {
      await ctx.close();
    },
  };
}

/**
 * Run a synthetic source through the same worklet + analyzer for `seconds`.
 * `build(ctx)` returns the AudioNode to analyse. Resolves to the frame track.
 */
export async function runSynthetic(build, seconds) {
  const { ctx, node, analyzer } = await openPipeline(() => {});
  build(ctx).connect(node);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await ctx.close();
  return analyzer.track;
}
