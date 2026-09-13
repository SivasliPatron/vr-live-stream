export const CONNECTION_MODE = Object.freeze({
  direct: "direct",
  compatibility: "compatibility",
});

const SCREENSHARE_BITRATE_KBPS = "6000";
const PLAYOUT_BUFFER_MS = "200";
// Public credentials of VDO's built-in German TLS fallback, not sender secrets.
// Explicit configuration avoids VDO's unbounded TURN-list download retry.
const VDO_FALLBACK_TURN = "steve;setupYourOwnPlease;turns:turn.obs.ninja:443";

export function isTrustedViewerBaseUrl(value) {
  return value === "https://vdo.ninja/" ||
    value === "https://steveseguin.github.io/vdo.ninja/";
}

export function buildViewerUrl(
  config,
  mode = CONNECTION_MODE.direct,
  { accessCode = "", muted = false, parentOrigin = "" } = {},
) {
  const url = new URL(config.viewerBaseUrl);
  // Treat this as a base address, never as a reusable sender/viewer invitation.
  // Stale passwords, names, approval flags and relay settings must not survive.
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", config.streamId);
  url.searchParams.set("audience", config.audienceToken);
  // Keep the production sender's password/stream hashing on the official mirror.
  url.searchParams.set("salt", "vdo.ninja");
  url.searchParams.set("turn", VDO_FALLBACK_TURN);
  if (/^https?:\/\//.test(parentOrigin)) {
    url.searchParams.set("iframetarget", new URL(parentOrigin).origin);
  }
  url.searchParams.set("cleanoutput", "");
  url.searchParams.set("screensharestereo", "");
  url.searchParams.set("screensharebitrate", SCREENSHARE_BITRATE_KBPS);
  url.searchParams.set("buffer", PLAYOUT_BUFFER_MS);
  url.searchParams.set("mutespeaker", muted ? "1" : "0");
  url.searchParams.set("retry", "10");
  url.searchParams.set("retrytimeout", "5000");
  url.searchParams.set("autorecover", "1");
  url.searchParams.set("autorelay", "1");
  url.searchParams.set("p2pfailtimeout", "7000");
  url.searchParams.set("peerrecoversteps", "5");
  url.searchParams.set("pendingicettl", "20000");

  const fragment = new URLSearchParams();

  if (mode === CONNECTION_MODE.compatibility) {
    url.searchParams.set("relay", "");
  }

  if (typeof accessCode === "string" && /^[0-9]{4}$/.test(accessCode)) {
    fragment.set("password", accessCode);
  }

  const fragmentValue = fragment.toString();
  if (fragmentValue) {
    url.hash = fragmentValue;
  }

  return url.toString();
}
