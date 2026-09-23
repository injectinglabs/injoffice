// Public releases opt in to signed publishing configuration. Local builds stay unsigned.
const {build} = require('./package.json');

// Set when a release deliberately ships macOS without a Developer ID identity. Gatekeeper will
// warn on first launch and updates fall back to downloading the DMG, so it is never a default.
const macUnsigned = process.env.INJOFFICE_MAC_UNSIGNED === '1';

// The release job declares CSC_LINK for every platform, so without a Mac certificate it is an
// empty string, not absent. electron-builder reads an empty CSC_LINK as a path relative to the
// working directory and fails "not a file" as soon as it signs, ad-hoc included. Clearing it here
// rather than in the workflow keeps it out of shell syntax: Windows runs steps in PowerShell.
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD']) {
  if (process.env[name] === '') delete process.env[name];
}

// Windows is signed by Azure Artifact Signing (formerly Trusted Signing): there is no
// certificate file, so electron-builder installs the TrustedSigning PowerShell module on the
// runner and signs through the account's certificate profile. The account identifiers are not
// secret and come from the workflow; the Entra credentials it authenticates with arrive as
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET, read by Azure.Identity itself.
// Absent configuration leaves win signing exactly as it was, so nothing else has to change.
const azureSigning = process.env.AZURE_SIGNING_ENDPOINT
  ? {
      endpoint: process.env.AZURE_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.AZURE_SIGNING_ACCOUNT,
      certificateProfileName: process.env.AZURE_SIGNING_CERT_PROFILE,
      // Must match the certificate subject exactly, or electron-builder refuses the signature.
      publisherName: process.env.AZURE_SIGNING_PUBLISHER_NAME,
    }
  : undefined;
module.exports = {
  ...build,
  extraMetadata: {injofficeRelease: true, ...(macUnsigned ? {injofficeMacSigned: false} : {})},
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  publish: {
    provider: 'github', owner: 'injectinglabs', repo: 'injoffice',
    releaseType: 'draft', tagNamePrefix: 'desktop-v',
  },
  ...(macUnsigned
    // identity '-' seals the bundle ad-hoc, the way the preview builds do. A null identity would
    // skip signing altogether, and macOS on Apple Silicon refuses to launch a binary carrying no
    // signature at all. hardenedRuntime stays off because an ad-hoc signature cannot satisfy
    // library validation, which would fail the app at launch.
    ? {mac: {...build.mac, forceCodeSigning: false, notarize: false, hardenedRuntime: false, identity: '-'}}
    : {mac: {...build.mac, forceCodeSigning: true, hardenedRuntime: true, notarize: true}}),
  win: {...build.win, forceCodeSigning: true, ...(azureSigning ? {azureSignOptions: azureSigning} : {})},
};
