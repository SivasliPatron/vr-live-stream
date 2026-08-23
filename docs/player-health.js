export function isSameStreamId(candidate, expected) {
  return (
    typeof candidate === "string" &&
    typeof expected === "string" &&
    candidate.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US")
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
