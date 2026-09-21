"use client";

import { fmt } from "@/lib/format";

type Props = {
  duration: number;
  start: number;
  end: number;
  minGap: number;
  onStart: (v: number) => void;
  onEnd: (v: number) => void;
};

/** One start/end range: two overlaid range inputs sharing a single track. */
export default function TrimSlider({ duration, start, end, minGap, onStart, onEnd }: Props) {
  const pct = (v: number) => (duration ? (v / duration) * 100 : 0);
  const gap = Math.min(minGap, duration);
  return (
    <div className="trim">
      <div className="trim-labels">
        <span>START {fmt(start)}</span>
        <span>{(end - start).toFixed(1)}s</span>
        <span>END {fmt(end)}</span>
      </div>
      <div className="trim-box">
        <div className="trim-track" />
        <div className="trim-sel" style={{ left: `${pct(start)}%`, right: `${100 - pct(end)}%` }} />
        <input
          type="range"
          aria-label="Start"
          min={0}
          max={duration}
          step={0.1}
          value={start}
          onChange={(e) => onStart(Math.min(Number(e.target.value), end - gap))}
        />
        <input
          type="range"
          aria-label="End"
          min={0}
          max={duration}
          step={0.1}
          value={end}
          onChange={(e) => onEnd(Math.max(Number(e.target.value), start + gap))}
        />
      </div>
    </div>
  );
}
