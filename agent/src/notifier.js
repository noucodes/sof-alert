const { createPublisher } = require('./ntfy');
const { ExpoPush } = require('./expo-push');

// Fans an alert out to ntfy (history + desktop app) and, when enabled, to the
// Android app via Expo push. Pass `topic` to publish to a side topic only
// (e.g. heartbeats), which never goes to phones.
function createNotifier(config, { devicesFile } = {}) {
  const ntfy = createPublisher(config.ntfy);
  const pushCfg = config.push || {};
  const push =
    pushCfg.enabled === false
      ? null
      : new ExpoPush(config.ntfy, { devicesFile, accessToken: pushCfg.accessToken, minPriority: pushCfg.minPriority });

  async function notify(payload) {
    const id = await ntfy.publish(payload);
    if (push && !payload.topic) await push.send(payload, typeof id === 'string' ? id : null);
    return id;
  }

  return { notify, push };
}

module.exports = { createNotifier };
