// Previews have no Developer ID certificate or public updater. A complete ad-hoc
// signature still seals the Mac bundle and replaces Electron's linker signature.
const {build} = require('./package.json');
module.exports = {
  ...build,
  mac: {...build.mac, identity: '-', hardenedRuntime: false, notarize: false},
};
