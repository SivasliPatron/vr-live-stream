export function isSameStreamId(candidate, expected) {
  return (
    typeof candidate === "string" &&
    typeof expected === "string" &&
    expected.length > 0 &&
    candidate === expected
  );
}

function isRecord(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isStreamCollection(value) {
  return (
    (isRecord(value) || Array.isArray(value)) &&
    Object.values(value).every(isRecord)
  );
}

function collectionContainsStream(collection, expectedStreamId) {
  if (!isStreamCollection(collection)) {
    return false;
  }

  if (Array.isArray(collection)) {
    return collection.some((item) =>
      isSameStreamId(item?.streamID ?? item?.streamId, expectedStreamId),
    );
  }

  return Object.entries(collection).some(
    ([key, value]) =>
      isSameStreamId(value.streamID ?? value.streamId ?? key, expectedStreamId),
  );
}

export function hasTargetInboundStream(payload, expectedStreamId) {
  const stats = payload?.stats ?? payload?.value?.stats ?? payload?.value ?? payload;
  if (!isRecord(stats)) {
    return false;
  }

  return [stats.inbound, stats.inbound_stats].some((collection) =>
    collectionContainsStream(collection, expectedStreamId),
  );
}

function nonNegativeCounter(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isVideoTrack(track) {
  if (!isRecord(track)) return false;
  if (track._type !== undefined) return track._type === "video";
  if (track.type !== undefined) {
    return track.type === "Video Stream" || track.type === "Video Track";
  }
  // VDO derives _type from the legacy mediaType field. It still copies actual
  // inbound video dimensions when a browser only exposes kind instead.
  return Number.isFinite(track._frameWidth) && track._frameWidth > 0 &&
    Number.isFinite(track._frameHeight) && track._frameHeight > 0;
}

// VDO getQuickStats exposes per-stream counters, plus individual track records.
// Audio and transport bytes do not prove that the requested video is arriving.
export function getTargetVideoStats(payload, expectedStreamId) {
  const stats = payload?.stats ?? payload?.value?.stats ?? payload?.value ?? payload;
  if (!isRecord(stats)) return null;

  for (const collection of [stats.inbound, stats.inbound_stats]) {
    if (!isStreamCollection(collection)) continue;

    for (const [key, stream] of Object.entries(collection)) {
      const streamId = stream.streamID ?? stream.streamId ??
        (Array.isArray(collection) ? undefined : key);
      if (!isSameStreamId(streamId, expectedStreamId)) continue;

      let framesDecoded = null;
      let trackBytesReceived = null;
      for (const track of Object.values(stream)) {
        if (!isVideoTrack(track)) continue;

        const frames = nonNegativeCounter(track._framesDecoded);
        const bytes = nonNegativeCounter(track._last_bytes);
        if (frames !== null) framesDecoded = (framesDecoded ?? 0) + frames;
        if (bytes !== null) trackBytesReceived = (trackBytesReceived ?? 0) + bytes;
      }

      framesDecoded = nonNegativeCounter(framesDecoded);
      const bytesReceived = nonNegativeCounter(stream._bytesReceived_video) ??
        nonNegativeCounter(trackBytesReceived);
      if (framesDecoded !== null || bytesReceived !== null) {
        return { framesDecoded, bytesReceived };
      }
    }
  }

  return null;
}

export function isTargetVideoEvent(message, expectedStreamId) {
  return (
    message?.action === "new-video-track-added" &&
    normalizeConnectionState(message.value) !== false &&
    isSameStreamId(message.streamID ?? message.streamId, expectedStreamId)
  );
}

export function getHealthStatsStatus(message, expectedStreamId) {
  if (message?.cib !== "health") {
    return "unrelated";
  }

  const stats = message?.stats ?? message?.value?.stats ?? message?.value;
  if (!isRecord(stats)) {
    return "malformed";
  }

  if (hasTargetInboundStream({ stats }, expectedStreamId)) {
    return "present";
  }

  // A reply without an actual inbound collection is not evidence of a lost
  // stream. In particular, API errors and partial replies must not disconnect it.
  const collections = [stats.inbound, stats.inbound_stats].filter(
    (collection) => collection !== undefined,
  );
  return collections.length > 0 && collections.every(isStreamCollection)
    ? "missing"
    : "malformed";
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
