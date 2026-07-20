/**
 * Score playback using Web Audio API.
 * Uses a look-ahead scheduler to handle scores of any length.
 */

import { ScoreData, DURATION_BEATS } from "../types";
import { midiToFrequency } from "./musicTheory";

export interface PlaybackHandle {
  stop(): void;
  finished: Promise<void>;
  /** Returns elapsed playback time in seconds. */
  getElapsed(): number;
  /** Time offset applied at playback start (seconds). */
  readonly timeOffset: number;
}

/**
 * Play a ScoreData through Web Audio API using triangle-wave oscillators.
 * Uses a look-ahead scheduler that schedules notes slightly ahead of the
 * current playback position, so scores of any length can be played without
 * hitting browser AudioNode limits.
 */
export function playScore(score: ScoreData, startMeasure?: number): PlaybackHandle {
  const ctx = new AudioContext();
  console.info("[Audio Score] playback requested", {
    contextState: ctx.state,
    startMeasure: startMeasure ?? 1,
    measures: score.measures.length,
    bpm: score.bpm,
  });
  // Windows WebView can create an AudioContext in the suspended state even
  // from a button or canvas gesture. Explicitly resume it so playback time,
  // scheduling, and the active-measure indicator all advance.
  if (ctx.state === "suspended") {
    void ctx.resume().then(() => {
      console.info("[Audio Score] AudioContext resumed", {
        contextState: ctx.state,
        currentTime: ctx.currentTime,
      });
    }).catch((error) => {
      console.error("[Audio Score] AudioContext resume failed", error);
    });
  }
  let stopped = false;

  const beatDuration = 60 / score.bpm;

  // How far ahead (seconds) to schedule notes
  const SCHEDULE_AHEAD = 1.0;
  // How often (ms) the scheduler runs
  const SCHEDULER_INTERVAL = 200;

  // Flatten all playable notes from startMeasure onwards, sorted by startTime
  const filteredMeasures = startMeasure != null
    ? score.measures.filter((m) => m.number >= startMeasure)
    : score.measures;
  const allNotes = filteredMeasures
    .flatMap((m) => m.notes)
    .filter((n) => n.midi >= 0)
    .sort((a, b) => a.startTime - b.startTime);
  // Analysis results retain their source-audio timeline and can begin with a
  // long stretch of silence. Start at the first playable note for both full
  // playback and playback from a selected measure.
  const timeOffset = allNotes.length > 0 ? allNotes[0].startTime : 0;
  console.info("[Audio Score] playback notes prepared", {
    notes: allNotes.length,
    contextState: ctx.state,
    timeOffset,
  });
  const baseTime = ctx.currentTime + 0.1 - timeOffset;

  let nextIndex = 0;
  let lastEnd = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let resolveFinished: (() => void) | null = null;

  function scheduleNote(note: (typeof allNotes)[number]) {
    const dur =
      DURATION_BEATS[note.durationType] * (note.dotted ? 1.5 : 1) * beatDuration;
    if (dur <= 0) return;

    const noteStart = baseTime + note.startTime;
    const freq = midiToFrequency(note.midi);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    const attack = Math.min(0.02, dur * 0.1);
    const release = Math.min(0.02, dur * 0.1);
    const sustainEnd = Math.max(noteStart + attack, noteStart + dur - release);
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(0.3, noteStart + attack);
    gain.gain.setValueAtTime(0.3, sustainEnd);
    gain.gain.linearRampToValueAtTime(0, noteStart + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(noteStart);
    osc.stop(noteStart + dur);

    const noteEnd = note.startTime + dur;
    if (noteEnd > lastEnd) lastEnd = noteEnd;
  }

  function scheduleAhead() {
    if (stopped) return;

    const now = ctx.currentTime;
    const horizon = now + SCHEDULE_AHEAD;

    while (nextIndex < allNotes.length) {
      const note = allNotes[nextIndex];
      const noteStart = baseTime + note.startTime;
      if (noteStart > horizon) break;
      scheduleNote(note);
      nextIndex++;
    }

    // All notes scheduled — set up a timeout to resolve when playback ends
    if (nextIndex >= allNotes.length && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;

      const remaining = (baseTime + lastEnd) - ctx.currentTime;
      const delayMs = Math.max(0, remaining * 1000) + 100;

      timeoutId = setTimeout(() => {
        if (!stopped) {
          ctx.close().catch(() => {});
        }
        resolveFinished?.();
        console.info("[Audio Score] playback finished", {
          contextState: ctx.state,
          notes: allNotes.length,
        });
      }, delayMs);
    }
  }

  // Start the scheduler
  scheduleAhead();
  intervalId = setInterval(scheduleAhead, SCHEDULER_INTERVAL);

  // Handle empty scores
  if (allNotes.length === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
    if (allNotes.length === 0) {
      ctx.close().catch(() => {});
      resolve();
    }
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (intervalId !== null) clearInterval(intervalId);
    if (timeoutId !== null) clearTimeout(timeoutId);
    ctx.close().catch(() => {});
    resolveFinished?.();
    console.info("[Audio Score] playback stopped", {
      contextState: ctx.state,
      currentTime: ctx.currentTime,
    });
  }

  function getElapsed(): number {
    if (stopped) return 0;
    return Math.max(0, ctx.currentTime - baseTime);
  }

  return { stop, finished, getElapsed, timeOffset };
}
