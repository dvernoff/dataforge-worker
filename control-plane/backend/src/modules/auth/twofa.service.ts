import { TOTP, Secret } from 'otpauth';
import crypto from 'crypto';

export class TwoFAService {
  generateSecret(email: string): { secret: string; uri: string } {
    const secret = new Secret();
    const totp = new TOTP({ issuer: 'DataForge', label: email, secret });
    return { secret: secret.base32, uri: totp.toString() };
  }

  verifyToken(secret: string, token: string): boolean {
    const totp = new TOTP({ secret: Secret.fromBase32(secret) });
    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  }

  generateBackupCodes(count = 8): string[] {
    return Array.from({ length: count }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );
  }
}
