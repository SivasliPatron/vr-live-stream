// Shared, public transport settings. No publisher secrets belong in this file.
export const transport = Object.freeze({
  base: "https://steveseguin.github.io/vdo.ninja/",
  salt: "vdo.ninja",
  // Public VDO.Ninja fallback credentials, not the stream's publishing key.
  turn: "steve;setupYourOwnPlease;turns:turn.obs.ninja:443",
  bitrate: "6000",
  buffer: "500",
});
export const codeIsValid = code => typeof code === "string" && /^\d{4}$/.test(code);
export const identityIsValid = identity => typeof identity?.id === "string" &&
  /^[A-Za-z0-9_-]{12,128}$/.test(identity.id) &&
  typeof identity.audience === "string" && /^[A-Za-z0-9_-]{12,128}$/.test(identity.audience);

export function streamUrl(identity, code, { publisher = false, fps = 60, muted = false, parent = "", nativeControls = false } = {}) {
  if (!identityIsValid(identity) || !codeIsValid(code)) throw new Error("Ungültiger Stream-Zugang.");
  if (![30, 60].includes(fps)) throw new Error("Ungültige Bildrate.");
  const url = new URL(transport.base);
  // VDO's history URL rewrite can strip the password value from the fragment.
  // Preserve the original address so a reload keeps the same access code.
  const common = { audience: identity.audience, salt: transport.salt, turn: transport.turn,
    nohistory: "", autorecover: "1", autorelay: "1", screensharestereo: "" };
  for (const [key, value] of Object.entries(common)) url.searchParams.set(key, value);
  url.searchParams.set(publisher ? "push" : "view", identity.id);
  if (publisher) {
    const capture = { screenshare: "", screensharequality: "1", screensharefps: String(fps),
      screensharecontenthint: "motion", displaysurface: "browser", systemaudio: "exclude", maxviewers: "6" };
    for (const [key, value] of Object.entries(capture)) url.searchParams.set(key, value);
  } else {
    // Keep VDO's in-player Play button for browsers that require a direct tap.
    // cleanoutput suppresses that autoplay-recovery control; cleanish keeps it.
    url.searchParams.set("cleanish", "");
    // Safari's native video controls provide iPhone fullscreen inside the iframe.
    if (nativeControls) url.searchParams.set("videocontrols", "");
    url.searchParams.set("screensharebitrate", transport.bitrate);
    url.searchParams.set("videobitrate", transport.bitrate);
    url.searchParams.set("scale", "100");
    url.searchParams.set("buffer", transport.buffer);
    url.searchParams.set("mutespeaker", muted ? "1" : "0");
    if (parent) {
      const origin = new URL(parent);
      if (!["http:", "https:"].includes(origin.protocol)) throw new Error("Ungültige Zuschauer-Seite.");
      url.searchParams.set("iframetarget", origin.origin);
    }
  }
  url.hash = new URLSearchParams({ password: code }).toString();
  return url.href;
}

// A targeted getStats request returns the stream's cached track records.
// Accept only video evidence; audio/transport bytes are deliberately ignored.
export function videoSample(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const videos = Object.values(stats).filter(track => {
    if (!track || typeof track !== "object") return false;
    if (track._type !== undefined) return track._type === "video";
    if (track.type !== undefined) return track.type === "Video Stream" || track.type === "Video Track";
    return Number.isFinite(track._frameWidth) && Number.isFinite(track._frameHeight) &&
      track._frameWidth > 0 && track._frameHeight > 0;
  });
  const number = value => Number.isFinite(value) && value >= 0 ? value : null;
  for (const track of videos) {
    const frames = number(track._framesDecoded);
    const bytes = number(track._last_bytes);
    const stamp = number(track._last_time);
    const fps = number(track.FPS);
    if (frames !== null || bytes !== null || (stamp !== null && fps !== null)) {
      return { frames, bytes, stamp, fps };
    }
  }
  return null;
}

export function sampleAdvanced(before, after) {
  if (!after) return false;
  // VDO only refreshes _framesDecoded when native framesPerSecond is missing.
  // A cached initial zero must not override fresh, positive FPS measurements.
  if (after.stamp !== null && after.fps !== null) return after.fps > 0 &&
    (!before || before.stamp === null || after.stamp > before.stamp);
  if (after.frames !== null) return after.frames > 0 &&
    (!before || (before.frames !== null && after.frames > before.frames));
  if (before?.frames !== null && before?.frames !== undefined) return false;
  return after.bytes !== null && after.bytes > 0 &&
    (!before || (before.bytes !== null && after.bytes > before.bytes));
}
