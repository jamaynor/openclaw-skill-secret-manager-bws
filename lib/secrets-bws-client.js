'use strict';

const crypto = require('crypto');
const os     = require('os');
const path   = require('path');
const { BitwardenClient, DeviceType } = require('@bitwarden/sdk-napi');
const { LogLevel } = require('@bitwarden/sdk-napi/binding');

/**
 * Creates an authenticated BitwardenClient.
 * Requires BWS_ACCESS_TOKEN in the environment.
 *
 * The SDK state file is keyed by a hash of the access token so that
 * concurrent processes using different tokens never share state.
 */
async function createClient(logLevel = LogLevel.Error) {
  const token = process.env.BWS_ACCESS_TOKEN;
  if (!token) {
    throw new Error('BWS_ACCESS_TOKEN is not set');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  const stateFile = path.join(os.tmpdir(), `.secrets-bws-state-${tokenHash}`);

  const settings = {
    apiUrl: 'https://api.bitwarden.com',
    identityUrl: 'https://identity.bitwarden.com',
    userAgent: 'secrets-bws',
    deviceType: DeviceType.SDK,
  };

  const client = new BitwardenClient(settings, logLevel);
  await client.auth().loginAccessToken(token, stateFile);
  return client;
}

/**
 * Returns BWS_ORGANIZATION_ID from the environment, or throws.
 */
function getOrgId() {
  const orgId = process.env.BWS_ORGANIZATION_ID;
  if (!orgId) {
    throw new Error('BWS_ORGANIZATION_ID is not set');
  }
  return orgId;
}

module.exports = { createClient, getOrgId };
