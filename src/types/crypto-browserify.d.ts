declare module 'browserify-cipher' {
  import { CipherGCM, DecipherGCM } from 'crypto';
  export function createCipheriv(algorithm: string, key: Buffer, iv: Buffer): CipherGCM;
  export function createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): DecipherGCM;
}

declare module 'crypto-browserify' {
  export function createHash(algorithm: string): {
    update(data: string | Buffer): { digest(): Buffer; digest(encoding: string): string };
  };
  export function createCipheriv(algorithm: string, key: Buffer, iv: Buffer): import('crypto').CipherGCM;
  export function createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): import('crypto').DecipherGCM;
}
