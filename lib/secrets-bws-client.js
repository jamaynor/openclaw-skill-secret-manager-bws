/**
 * secrets-bws-client
 *
 * Responsibility: Creates and returns an authenticated BitwardenClient using
 * the Bitwarden SDK, and exposes the organization ID reader.
 *
 * Public Interface:
 * secrets-bws-client
 * ├── createClient(logLevel?): Promise<BitwardenClient>
 * └── getOrgId(): string
 */

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { BitwardenClient, DeviceType } from '@bitwarden/sdk-napi';
import { LogLevel } from '@bitwarden/sdk-napi/binding.js';

/**
 * Creates an authenticated BitwardenClient.
 * Requires HAL_BWS_ACCESS_TOKEN in the environment.
 *
 * The SDK state file is keyed by a hash of the access token so that
 * concurrent processes using different tokens never share state.
 *
 * API endpoints default to production Bitwarden but can be overridden via:
 *   BWS_API_URL      — overrides https://api.bitwarden.com
 *   BWS_IDENTITY_URL — overrides https://identity.bitwarden.com
 */
async function createClient(logLevel = LogLevel.Error) {
  const token = process.env.HAL_BWS_ACCESS_TOKEN;
  if (!token) {
    throw new Error('HAL_BWS_ACCESS_TOKEN is not set');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
  const stateFile = path.join(os.tmpdir(), `.secrets-bws-state-${tokenHash}`);

  const settings = {
    apiUrl:      process.env.BWS_API_URL      ?? 'https://api.bitwarden.com',
    identityUrl: process.env.BWS_IDENTITY_URL ?? 'https://identity.bitwarden.com',
    userAgent: 'secrets-bws',
    deviceType: DeviceType.SDK,
  };

  const client = new BitwardenClient(settings, logLevel);
  await client.auth().loginAccessToken(token, stateFile);
  return client;
}

/**
 * Returns HAL_BWS_ORGANIZATION_ID from the environment, or throws.
 */
function getOrgId() {
  const orgId = process.env.HAL_BWS_ORGANIZATION_ID;
  if (!orgId) {
    throw new Error('HAL_BWS_ORGANIZATION_ID is not set');
  }
  return orgId;
}

export { createClient, getOrgId };
