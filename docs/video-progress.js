// Only repeated, comparable video samples can confirm a frozen stream.
// Missing replies and background throttling are not evidence of a video stall.
export function createVideoProgressMonitor({
  warningMs = 12_000,
  reconnectMs = 30_000,
  maxSampleGapMs = 6_000,
} = {}) {
  let previous = null;
  let sampledAt = null;
  let stalledSince = null;

  function suspend() {
    sampledAt = null;
    stalledSince = null;
  }

  return {
    suspend,
    reset() {
      previous = null;
      suspend();
    },
    observe(sample, now) {
      const valid = (value) => Number.isFinite(value) && value >= 0;
      // Once decoded-frame counters exist, arriving bytes cannot hide a stuck
      // decoder. Temporarily missing frame counters are an unknown result.
      const metric = valid(sample?.framesDecoded) ? "framesDecoded"
        : previous?.metric !== "framesDecoded" && valid(sample?.bytesReceived)
          ? "bytesReceived" : null;
      if (!metric || !Number.isFinite(now)) {
        suspend();
        return { progressed: false, status: "unknown" };
      }

      const value = sample[metric];
      const comparable = previous?.metric === metric;
      const progressed = value > 0 && (previous === null ||
        (comparable && value > previous.value));
      const continuous = comparable && sampledAt !== null &&
        now >= sampledAt && now - sampledAt <= maxSampleGapMs &&
        value >= previous.value;

      if (progressed || !continuous) {
        stalledSince = now;
      }
      previous = { metric, value };
      sampledAt = now;
      const stalledFor = now - stalledSince;
      return {
        progressed,
        status: progressed ? "progressing"
          : stalledFor >= reconnectMs ? "stalled"
            : stalledFor >= warningMs ? "recovering" : "waiting",
      };
    },
  };
}
