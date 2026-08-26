export function createFullscreenTransitionGate({
  cooldownMs = 450,
  now = () => performance.now(),
} = {}) {
  let pending = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  return {
    isPending() {
      return pending;
    },

    tryStart({ bypassCooldown = false } = {}) {
      const currentTime = Number(now());
      if (pending) {
        return false;
      }

      if (!bypassCooldown && currentTime - lastStartedAt < cooldownMs) {
        return false;
      }

      pending = true;
      lastStartedAt = currentTime;
      return true;
    },

    finish() {
      pending = false;
    },
  };
}
