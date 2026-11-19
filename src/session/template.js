// Daily session template (DESIGN.md section 8).
// kind: 'warmup' (not measured), 'speech' (measured and scored), 'drill' (optional, not scored).
// rateTarget: the ladder rate is shown and cued. ladder: this segment is the block that
// decides ladder progress. transfer: approaching a harder speaking situation.

export const SEGMENTS = [
  {
    id: 'warmup',
    title: 'Warm-up',
    minutes: 3,
    kind: 'warmup',
    intro: 'Loosen the voice. Nothing here is scored.',
    content: 'warmup',
  },
  {
    id: 'breath',
    title: 'Breath-group phrasing',
    minutes: 3,
    kind: 'speech',
    rateTarget: true,
    intro: 'Breathe low and easy. Say one phrase on one smooth breath, then pause and breathe before the next.',
    content: 'phrases',
  },
  {
    id: 'reading',
    title: 'Reading at your rate step',
    minutes: 4,
    kind: 'speech',
    rateTarget: true,
    ladder: true,
    intro: 'Stretch the sounds to hold the target rate. Start each phrase softly and keep lips and tongue light.',
    content: 'reading',
  },
  {
    id: 'monologue',
    title: 'Monologue',
    minutes: 3,
    kind: 'speech',
    transfer: true,
    intro: 'Speak as if to the room. Keep the soft starts; let the rate be natural.',
    content: 'monologue',
  },
  {
    id: 'phone',
    title: 'Phone call',
    minutes: 3,
    kind: 'speech',
    transfer: true,
    intro: 'Hold the phone to your ear if it helps. Answer each line aloud, then tap for the next.',
    content: 'phone',
  },
  {
    id: 'spontaneous',
    title: 'Spontaneous topic',
    minutes: 3,
    kind: 'speech',
    intro: 'Talk freely about the topic. Going forward matters more than sounding smooth.',
    content: 'topic',
  },
  {
    id: 'drill',
    title: 'Block-modification drill',
    minutes: 2,
    kind: 'drill',
    optional: true,
    intro: 'Optional. Practise handling a block on purpose, calmly.',
    content: 'drill',
  },
];

const COMPLETION_SHARE = 0.8;

/** A segment counts as completed once 80% of its planned time has been spent in it. */
export function isCompleted(plannedSec, elapsedSec) {
  return elapsedSec >= plannedSec * COMPLETION_SHARE - 1e-9;
}

export function coreMinutes() {
  return SEGMENTS.filter((s) => !s.optional).reduce((sum, s) => sum + s.minutes, 0);
}

export function segmentById(id) {
  return SEGMENTS.find((s) => s.id === id);
}
