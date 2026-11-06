const { notarize } = require('@electron/notarize');

/**
 * electron-builder afterSign hook. Unsigned or credential-less builds are
 * allowed; the release workflow only enables this path when Apple secrets are
 * configured.
 */
module.exports = async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('buffy: skipping notarization (Apple credentials are not configured)');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;
  console.log(`buffy: notarizing ${appPath}`);
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
