import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomUUID,
} from 'crypto';
import { genSalt, hash, compare } from 'bcrypt';
import { deflateSync, inflateSync } from 'zlib';
import { Env } from './env';
import { createLogger } from './logger';

const logger = createLogger('crypto');

const saltRounds = 10;

const compressData = (data: string): Buffer => {
  return deflateSync(Buffer.from(data, 'utf-8'), {
    level: 9,
  });
};

const decompressData = (data: Buffer): string => {
  return inflateSync(data).toString('utf-8');
};

const encryptData = (
  secretKey: Buffer,
  data: Buffer
): { iv: string; data: string } => {
  // Then encrypt the compressed data
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', secretKey, iv);

  const encryptedData = Buffer.concat([cipher.update(data), cipher.final()]);

  return {
    iv: iv.toString('base64'),
    data: encryptedData.toString('base64'),
  };
};

const decryptData = (
  secretKey: Buffer,
  encryptedData: Buffer,
  iv: Buffer
): Buffer => {
  const decipher = createDecipheriv('aes-256-cbc', secretKey, iv);

  // Decrypt the data
  const decryptedData = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decryptedData;
};

type SuccessResponse = {
  success: true;
  data: string;
  error: null;
};

type ErrorResponse = {
  success: false;
  error: string;
  data: null;
};

export type Response = SuccessResponse | ErrorResponse;

/**
 * Encrypts a string using AES-256-CBC encryption, returns a string in the format "iv:encrypted" where
 * iv and encrypted are url encoded.
 * @param data Data to encrypt
 * @param secretKey Secret key used for encryption
 * @returns Encrypted data or error message
 */
export function encryptString(data: string, secretKey?: Buffer): Response {
  if (!secretKey) {
    secretKey = Buffer.from(Env.SECRET_KEY, 'hex');
  }
  try {
    const compressed = compressData(data);
    const { iv, data: encrypted } = encryptData(secretKey, compressed);
    return {
      success: true,
      data: `${encodeURIComponent(iv)}:${encodeURIComponent(encrypted)}`,
      error: null,
    };
  } catch (error: any) {
    logger.error(`Failed to encrypt data: ${error.message}`);
    return {
      success: false,
      error: error.message,
      data: null,
    };
  }
}

/**
 * Decrypts a string using AES-256-CBC encryption
 * @param data Encrypted data to decrypt
 * @param secretKey Secret key used for encryption
 * @returns Decrypted data or error message
 */
export function decryptString(data: string, secretKey?: Buffer): Response {
  if (!secretKey) {
    secretKey = Buffer.from(Env.SECRET_KEY, 'hex');
  }
  try {
    const [ivHex, encryptedHex] = data.split(':').map(decodeURIComponent);
    const iv = Buffer.from(ivHex, 'base64');
    const encrypted = Buffer.from(encryptedHex, 'base64');
    const decrypted = decryptData(secretKey, encrypted, iv);
    const decompressed = decompressData(decrypted);
    return {
      success: true,
      data: decompressed,
      error: null,
    };
  } catch (error: any) {
    logger.error(`Failed to decrypt data: ${error.message}`);
    return {
      success: false,
      error: error.message,
      data: null,
    };
  }
}

export function getSimpleTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Creates a secure hash of text using PBKDF2
 * @param text Text to hash
 * @returns Object containing the hash and salt used
 */
export async function getTextHash(text: string): Promise<string> {
  return await hash(text, await genSalt(saltRounds));
}

/**
 * Verifies if the provided text matches a previously generated hash
 * @param text Text to verify
 * @param storedHash Previously generated hash
 * @returns Boolean indicating if the text matches the hash
 */
export async function verifyHash(
  text: string,
  storedHash: string
): Promise<boolean> {
  return compare(text, storedHash);
}

/**
 * Derives a 64 character hex string from a password using PBKDF2
 * @param password Password to derive key from
 * @param salt Optional salt, will be generated if not provided
 * @returns Object containing the key and salt used
 */
export async function deriveKey(
  password: string,
  salt?: string
): Promise<{ key: Buffer; salt: string }> {
  salt = salt || (await genSalt(saltRounds));
  const key = pbkdf2Sync(
    Buffer.from(password, 'utf-8'),
    Buffer.from(salt, 'hex'),
    100000,
    32,
    'sha512'
  );
  return { key, salt };
}

export function generateUUID(): string {
  return randomUUID();
}
