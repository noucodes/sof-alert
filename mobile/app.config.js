const fs = require('fs');
const path = require('path');

// google-services.json comes from your Firebase project (see README). It's
// only wired in once it exists, so the app still bundles before Firebase is
// set up — push just won't work until then.
module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(googleServices)) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
