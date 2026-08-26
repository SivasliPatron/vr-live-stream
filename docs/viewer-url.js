export const CONNECTION_MODE = Object.freeze({
  direct: "direct",
  compatibility: "compatibility",
});

const SCREENSHARE_BITRATE_KBPS = "6000";
const PLAYOUT_BUFFER_MS = "200";

export function buildViewerUrl(config, mode = CONNECTION_MODE.direct) {
  const url = new URL(config.viewerBaseUrl);
  url.searchParams.set("view", config.streamId);
  url.searchParams.set("audience", config.audienceToken);
  url.searchParams.set("cleanoutput", "");
  url.searchParams.set("screensharestereo", "");
  url.searchParams.set("screensharebitrate", SCREENSHARE_BITRATE_KBPS);
  url.searchParams.set("buffer", PLAYOUT_BUFFER_MS);
  url.searchParams.set("mutespeaker", "1");
  url.searchParams.set("retry", "15");
  url.searchParams.set("retrytimeout", "5000");
  url.searchParams.set("autorecover", "1");
  url.searchParams.set("autorelay", "1");
  url.searchParams.set("p2pfailtimeout", "12000");
  url.searchParams.set("pendingicettl", "20000");

  if (mode === CONNECTION_MODE.compatibility) {
    url.searchParams.set("relay", "");
  }

  return url.toString();
}
