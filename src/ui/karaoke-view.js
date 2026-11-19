// Karaoke pacer on screen: renders syllable-marked lines and moves the highlight at the target
// rate. The current syllable gets a soft highlight with a bar filling underneath it over its
// whole beat, so a slow rate shows as "stretch this syllable", not "wait, then say it".

import { buildSchedule, positionAt, COUNT_IN_SEC } from '../live/karaoke.js';

/**
 * @param o.box        element the text is rendered into
 * @param o.status     element for "Starting in 3", "Breathe", "Paused"
 * @param o.lines      syllable-marked lines
 * @param o.spm        target syllables per minute
 * @param o.pauseBeats breath pause after each line, in beats
 * @param o.single     show only the current line (breath-group phrases) instead of all lines
 * @param o.onDone     called once the last line and its pause are over
 */
export function createKaraoke({ box, status, lines, spm, pauseBeats = 1, single = false, onDone = () => {} }) {
  const schedule = buildSchedule(lines, spm, { pauseBeats });
  let spans = []; // syllable spans by global index (only the rendered ones exist)
  let breaths = []; // breath chips by line
  let lineEls = [];
  let shownLine = -1;
  let lastIndex = -1;
  let startMs = 0;
  let pausedAt = null;
  let frame = 0;
  let finished = false;

  function renderLines(only) {
    spans = [];
    breaths = [];
    lineEls = [];
    let index = 0;
    const nodes = [];
    schedule.lines.forEach((line, li) => {
      const p = document.createElement('p');
      p.className = 'k-line';
      line.words.forEach((w, wi) => {
        const word = document.createElement('span');
        word.className = 'kw';
        for (const syl of w.syllables) {
          const s = document.createElement('span');
          s.className = 'ks';
          s.textContent = syl;
          word.append(s);
          spans[index++] = s;
        }
        p.append(word);
        if (wi < line.words.length - 1) p.append(' ');
      });
      const chip = document.createElement('span');
      chip.className = 'k-breath';
      chip.textContent = 'breathe';
      chip.setAttribute('aria-hidden', 'true');
      p.append(' ', chip);
      breaths[li] = chip;
      lineEls[li] = p;
      if (only === undefined || only === li) nodes.push(p);
    });
    box.replaceChildren(...nodes);
  }

  function say(text) {
    if (status.textContent !== text) status.textContent = text;
  }

  function draw() {
    const elapsed = ((pausedAt ?? performance.now()) - startMs) / 1000 - COUNT_IN_SEC;
    const pos = positionAt(schedule, elapsed);

    if (pos.phase === 'countIn') {
      say(`Starting in ${pos.secondsLeft}`);
    } else if (pos.phase === 'done') {
      if (!finished) {
        finished = true;
        cancelAnimationFrame(frame);
        onDone();
      }
      return;
    } else {
      say(pausedAt !== null ? 'Paused. Take your time, then press Resume.' : pos.phase === 'pause' ? 'Breathe' : '');
      if (single && pos.line !== shownLine) {
        shownLine = pos.line;
        renderLines(pos.line);
        lastIndex = -1;
      } else if (!single && pos.line !== shownLine) {
        shownLine = pos.line;
        lineEls.forEach((el, i) => el.classList.toggle('current', i === pos.line));
        lineEls[pos.line].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      // Syllables before the current one are done; the current one fills over its beat.
      const index = pos.phase === 'syllable' ? pos.index : firstIndexAfterLine(pos.line) - 1;
      if (index !== lastIndex) {
        for (let i = Math.max(0, Math.min(lastIndex, index)); i < spans.length; i++) {
          if (!spans[i]) continue;
          spans[i].classList.toggle('done', i < index || (pos.phase === 'pause' && i === index));
          spans[i].classList.toggle('now', pos.phase === 'syllable' && i === index);
        }
        lastIndex = index;
      }
      if (pos.phase === 'syllable' && spans[pos.index]) spans[pos.index].style.setProperty('--p', pos.frac.toFixed(3));
      breaths.forEach((chip, i) => chip.classList.toggle('now', pos.phase === 'pause' && i === pos.line));
    }
    if (pausedAt === null) frame = requestAnimationFrame(draw);
  }

  function firstIndexAfterLine(line) {
    let n = 0;
    for (let i = 0; i <= line; i++) n += schedule.lines[i].count;
    return n;
  }

  return {
    schedule,
    start() {
      finished = false;
      shownLine = -1;
      lastIndex = -1;
      pausedAt = null;
      renderLines(single ? 0 : undefined);
      if (single) shownLine = 0;
      startMs = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    },
    pause() {
      if (pausedAt !== null || finished) return;
      pausedAt = performance.now();
      cancelAnimationFrame(frame);
      draw();
    },
    resume() {
      if (pausedAt === null) return;
      startMs += performance.now() - pausedAt;
      pausedAt = null;
      frame = requestAnimationFrame(draw);
    },
    get paused() {
      return pausedAt !== null;
    },
    stop() {
      cancelAnimationFrame(frame);
      finished = true;
      say('');
    },
  };
}
