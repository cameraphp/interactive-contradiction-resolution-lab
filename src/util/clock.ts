export interface Clock {
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

/** Deterministic clock for the demo, benchmark and tests: every call advances by `stepMs`. */
export function fixedClock(startIso = "2026-11-11T10:00:00.000Z", stepMs = 1000): Clock {
  let t = Date.parse(startIso);
  return {
    now() {
      const value = new Date(t).toISOString();
      t += stepMs;
      return value;
    },
  };
}
