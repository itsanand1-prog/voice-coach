// AudioWorklet: forwards mono input to the main thread in ~1024-sample batches.
// Analysis happens off the audio thread so a slow frame can never drop input.

const BATCH = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BATCH);
    this.fill = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let at = 0;
      while (at < ch.length) {
        const take = Math.min(ch.length - at, BATCH - this.fill);
        this.buf.set(ch.subarray(at, at + take), this.fill);
        this.fill += take;
        at += take;
        if (this.fill === BATCH) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(BATCH);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
