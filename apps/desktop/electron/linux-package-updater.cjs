const {existsSync} = require('node:fs');
const {isAbsolute} = require('node:path');
const {spawnSync} = require('node:child_process');

// Keep electron-updater's download/cache/hash verification. Install its verified
// package through the system manager with literal argv (no shell), preserving
// package-manager signature/dependency checks and administrator authorization.
function installLinuxPackage(format, file, {exists = existsSync, run = spawnSync, uid = process.getuid?.()} = {}) {
  if (typeof file !== 'string' || !isAbsolute(file) || !file.endsWith(`.${format}`)) throw new Error('Invalid update package');
  const managers = format === 'deb' ? [
    ['/usr/bin/apt-get', ['install', '-y', file]],
  ] : format === 'rpm' ? [
    ['/usr/bin/dnf', ['install', '-y', file]],
    ['/usr/bin/zypper', ['--non-interactive', 'install', file]],
    ['/usr/bin/yum', ['install', '-y', file]],
    ['/usr/bin/rpm', ['-Uvh', file]],
  ] : [];
  const manager = managers.find(([binary]) => exists(binary));
  if (!manager) throw new Error('No supported system package manager');
  let [command, args] = manager;
  if (uid !== 0) {
    if (exists('/usr/bin/pkexec')) {
      args = ['--disable-internal-agent', command, ...args];
      command = '/usr/bin/pkexec';
    } else if (exists('/usr/bin/sudo')) {
      // Headless/policy-managed systems may grant noninteractive sudo. Never
      // hang the application waiting for a password on an invisible terminal.
      args = ['-n', '--', command, ...args];
      command = '/usr/bin/sudo';
    } else throw new Error('System authorization is unavailable');
  }
  const result = run(command, args, {shell: false, encoding: 'utf8', maxBuffer: 1024 * 1024});
  if (result.error || result.status !== 0) throw new Error('System authorization or package installation failed');
}

function withLinuxInstaller(Updater, format) {
  return class extends Updater {
    doInstall(options) {
      try {
        // LinuxUpdater.installerPath escapes for shell execution; we use the raw
        // cache filename with shell:false so spaces and apostrophes stay literal.
        installLinuxPackage(format, this.downloadedUpdateHelper?.file);
        if (options.isForceRunAfter) this.app.relaunch();
        return true;
      } catch (error) {
        this.dispatchError(error);
        return false;
      }
    }
  };
}

module.exports = {installLinuxPackage, withLinuxInstaller};
