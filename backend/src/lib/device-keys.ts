import { createHash, createPublicKey, verify } from 'node:crypto';
import { badRequest } from './errors';

const MAX_PUBLIC_KEY_LENGTH = 4096;

export interface DevicePublicKey {
  pem: string;
  fingerprint: string;
}

export function parseDevicePublicKey(base64Der: string): DevicePublicKey {
  const normalised = base64Der.replace(/\s+/g, '');
  if (
    normalised.length === 0 ||
    normalised.length > MAX_PUBLIC_KEY_LENGTH ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalised)
  ) {
    throw badRequest('INVALID_PUBLIC_KEY', 'Public key must be Base64-encoded DER');
  }

  const der = Buffer.from(normalised, 'base64');
  if (der.length === 0) {
    throw badRequest('INVALID_PUBLIC_KEY', 'Public key must be Base64-encoded DER');
  }

  let key;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw badRequest('INVALID_PUBLIC_KEY', 'Public key is not a valid SubjectPublicKeyInfo');
  }

  if (
    key.asymmetricKeyType !== 'ec' ||
    key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw badRequest('INVALID_PUBLIC_KEY', 'Only P-256 EC public keys are supported');
  }

  return {
    pem: key.export({ type: 'spki', format: 'pem' }).toString(),
    fingerprint: createHash('sha256').update(der).digest('hex'),
  };
}

export function verifyDeviceSignature(
  publicKeyPem: string,
  challenge: string,
  signatureBase64: string,
): boolean {
  try {
    const signature = Buffer.from(signatureBase64.replace(/\s+/g, ''), 'base64');
    if (signature.length === 0) return false;
    return verify(
      'sha256',
      Buffer.from(challenge, 'utf8'),
      { key: createPublicKey(publicKeyPem), dsaEncoding: 'der' },
      signature,
    );
  } catch {
    return false;
  }
}
