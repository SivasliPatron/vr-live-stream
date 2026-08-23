export function isSameStreamId(candidate, expected) {
  return (
    typeof candidate === "string" &&
    typeof expected === "string" &&
    candidate === expected
  );
}

function collectionContainsStream(collection, expectedStreamId) {
  if (!collection || typeof collection !== "object") {
    return false;
  }

  if (Array.isArray(collection)) {
    return collection.some((item) =>
      isSameStreamId(item?.streamID ?? item?.streamId, expectedStreamId),
    );
  }

  return Object.entries(collection).some(
    ([key, value]) =>
      isSameStreamId(key, expectedStreamId) ||
      isSameStreamId(value?.streamID ?? value?.streamId, expectedStreamId),
  );
}

export function hasTargetInboundStream(payload, expectedStreamId) {
  const stats = payload?.stats ?? payload?.value?.stats ?? payload?.value ?? payload;
  if (!stats || typeof stats !== "object") {
    return false;
  }

  return [stats.inbound, stats.inbound_stats].some((collection) =>
    collectionContainsStream(collection, expectedStreamId),
  );
}

export function isTargetVideoEvent(message, expectedStreamId) {
  return (
    message?.action === "new-video-track-added" &&
    message.value !== false &&
    isSameStreamId(message.streamID ?? message.streamId, expectedStreamId)
  );
}

export function getHealthStatsStatus(message, expectedStreamId) {
  if (message?.cib !== "health") {
    return "unrelated";
  }

  const stats = message?.stats ?? message?.value?.stats ?? message?.value;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return "malformed";
  }

  return hasTargetInboundStream({ stats }, expectedStreamId) ? "present" : "missing";
}

export function nextConfirmedMissingCount(currentCount, healthStatus) {
  if (healthStatus === "present") {
    return 0;
  }

  if (healthStatus === "missing") {
    return currentCount + 1;
  }

  return currentCount;
}

export function normalizeConnectionState(value) {
  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  return null;
}
