import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service.js';
import { TwoFAService } from './twofa.service.js';
import { loginBodySchema, registerBodySchema } from './auth.schema.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { createBruteForceMiddleware, recordFailedAttempt, clearFailedAttempts } from '../../middleware/brute-force.middleware.js';
import { signTempToken, verifyTempToken, signAccessToken, signRefreshToken } from './jwt.utils.js';
import { comparePassword, hashPassword } from '../../utils/crypto.js';
import { AppError } from '../../middleware/error-handler.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { UserPayload } from '../../../../../shared/types/auth.types.js';

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService(app.db);
  const twoFAService = new TwoFAService();
  const bruteForceMiddleware = createBruteForceMiddleware(app.redis);

  app.post('/register', async (request, reply) => {
    const body = registerBodySchema.parse(request.body);
    const result = await authService.register(body);

    reply.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    logAudit(request, 'auth.register', 'user', String(result.user.id));

    return {
      user: result.user,
      accessToken: result.accessToken,
    };
  });

  app.post('/login', { preHandler: [bruteForceMiddleware] }, async (request, reply) => {
    const body = loginBodySchema.parse(request.body);

    try {
      const user = await app.db('users').where({ email: body.email }).first();
      if (user && user.totp_enabled) {
        const valid = await comparePassword(body.password, user.password_hash);
        if (!valid) {
          await recordFailedAttempt(app.redis, request.ip);
          throw new AppError(401, 'Invalid email or password');
        }

        if (!user.is_active) {
          throw new AppError(403, 'Account is deactivated');
        }

        await clearFailedAttempts(app.redis, request.ip);

        const tempToken = signTempToken(user.id);
        return {
          requires_2fa: true,
          temp_token: tempToken,
        };
      }

      const result = await authService.login(body.email, body.password);

      await clearFailedAttempts(app.redis, request.ip);

      reply.setCookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60,
      });

      logAudit(request, 'auth.login', 'user', String(result.user.id));

      const { totp_secret, backup_codes, password_hash, ...safeUser } = result.user as Record<string, unknown>;
      return {
        user: safeUser,
        accessToken: result.accessToken,
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        await recordFailedAttempt(app.redis, request.ip);
      }
      throw error;
    }
  });

  app.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies.refreshToken;
    if (!refreshToken) {
      return reply.status(401).send({ error: 'Refresh token required' });
    }

    const result = await authService.refresh(refreshToken);

    reply.setCookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });

    return {
      user: result.user,
      accessToken: result.accessToken,
    };
  });

  app.post('/logout', { preHandler: [authMiddleware] }, async (request, reply) => {
    const refreshToken = request.cookies.refreshToken;
    await authService.logout(request.user.id, refreshToken);

    reply.clearCookie('refreshToken', {
      path: '/api/auth',
    });

    logAudit(request, 'auth.logout', 'user', request.user.id);

    return { message: 'Logged out successfully' };
  });

  app.get('/me', { preHandler: [authMiddleware] }, async (request) => {
    const user = await app.db('users')
      .where({ id: request.user.id, is_active: true })
      .select('id', 'email', 'name', 'is_superadmin', 'is_active', 'last_login_at', 'totp_enabled', 'created_at', 'updated_at')
      .first();

    if (!user) {
      throw new Error('User not found');
    }

    return { user };
  });

  app.post('/change-password', { preHandler: [authMiddleware] }, async (request) => {
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };

    if (!currentPassword || !newPassword) {
      throw new AppError(400, 'Current password and new password are required');
    }

    if (newPassword.length < 6) {
      throw new AppError(400, 'New password must be at least 6 characters');
    }

    const user = await app.db('users').where({ id: request.user.id }).first();
    if (!user) throw new AppError(404, 'User not found');

    const valid = await comparePassword(currentPassword, user.password_hash);
    if (!valid) {
      throw new AppError(401, 'Current password is incorrect');
    }

    const newHash = await hashPassword(newPassword);
    await app.db('users').where({ id: user.id }).update({ password_hash: newHash });

    logAudit(request, 'auth.change_password', 'user', request.user.id);

    return { success: true };
  });

  app.post('/2fa/setup', { preHandler: [authMiddleware] }, async (request) => {
    const { password } = (request.body as { password?: string }) ?? {};

    if (!password || typeof password !== 'string') {
      throw new AppError(400, 'Password is required to set up 2FA');
    }

    const user = await app.db('users').where({ id: request.user.id }).first();
    if (!user) throw new AppError(404, 'User not found');

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      throw new AppError(401, 'Invalid password');
    }

    if (user.totp_enabled) {
      throw new AppError(400, '2FA is already enabled');
    }

    const { secret, uri } = twoFAService.generateSecret(user.email);
    const backupCodes = twoFAService.generateBackupCodes();

    await app.db('users').where({ id: user.id }).update({
      totp_secret: secret,
      backup_codes: backupCodes,
    });

    return { secret, uri, backup_codes: backupCodes };
  });

  app.post('/2fa/verify-setup', { preHandler: [authMiddleware] }, async (request) => {
    const { token } = request.body as { token: string };

    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'Token is required');
    }

    const user = await app.db('users').where({ id: request.user.id }).first();
    if (!user) throw new AppError(404, 'User not found');

    if (user.totp_enabled) {
      throw new AppError(400, '2FA is already enabled');
    }

    if (!user.totp_secret) {
      throw new AppError(400, 'Call /2fa/setup first');
    }

    const valid = twoFAService.verifyToken(user.totp_secret, token);
    if (!valid) {
      throw new AppError(400, 'Invalid token');
    }

    await app.db('users').where({ id: user.id }).update({
      totp_enabled: true,
    });

    logAudit(request, 'auth.2fa.enabled', 'user', request.user.id);

    return { success: true };
  });

  app.post('/2fa/verify', async (request, reply) => {
    const { token, temp_token } = request.body as { token: string; temp_token: string };

    if (!token || !temp_token) {
      throw new AppError(400, 'Token and temp_token are required');
    }

    // Atomically mark temp token as used (prevents race condition replay)
    const tempTokenHash = crypto.createHash('sha256').update(temp_token).digest('hex');
    const claimed = await app.redis.set(`temp-used:${tempTokenHash}`, '1', 'EX', 300, 'NX');
    if (!claimed) {
      throw new AppError(401, 'Token already used');
    }

    let payload: { id: string };
    try {
      payload = verifyTempToken(temp_token);
    } catch {
      throw new AppError(401, 'Invalid or expired temporary token');
    }

    const user = await app.db('users').where({ id: payload.id, is_active: true }).first();
    if (!user) throw new AppError(401, 'User not found or deactivated');

    if (!user.totp_enabled || !user.totp_secret) {
      throw new AppError(400, '2FA is not enabled for this user');
    }

    const valid = twoFAService.verifyToken(user.totp_secret, token);
    if (!valid) {
      throw new AppError(401, 'Invalid 2FA token');
    }

    await app.db('users').where({ id: user.id }).update({ last_login_at: new Date() });

    // Generate full tokens
    const userPayload: UserPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      is_superadmin: user.is_superadmin,
    };

    const accessToken = signAccessToken(userPayload);
    const refreshToken = signRefreshToken(user.id);

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await app.db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });

    logAudit(request, 'auth.login', 'user', user.id);

    const { password_hash: _, totp_secret: __, backup_codes: ___, ...sanitizedUser } = user;
    return { user: sanitizedUser, accessToken };
  });

  app.post('/2fa/disable', { preHandler: [authMiddleware] }, async (request) => {
    const { password } = request.body as { password: string };

    if (!password || typeof password !== 'string') {
      throw new AppError(400, 'Password is required');
    }

    const user = await app.db('users').where({ id: request.user.id }).first();
    if (!user) throw new AppError(404, 'User not found');

    if (!user.totp_enabled) {
      throw new AppError(400, '2FA is not enabled');
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      throw new AppError(401, 'Invalid password');
    }

    await app.db('users').where({ id: user.id }).update({
      totp_secret: null,
      totp_enabled: false,
      backup_codes: null,
    });

    logAudit(request, 'auth.2fa.disabled', 'user', request.user.id);

    return { success: true };
  });

  app.post('/2fa/backup-verify', async (request, reply) => {
    const { code, temp_token } = request.body as { code: string; temp_token: string };

    if (!code || !temp_token) {
      throw new AppError(400, 'Code and temp_token are required');
    }

    // Atomically mark temp token as used (prevents race condition replay)
    const backupTokenHash = crypto.createHash('sha256').update(temp_token).digest('hex');
    const backupClaimed = await app.redis.set(`temp-used:${backupTokenHash}`, '1', 'EX', 300, 'NX');
    if (!backupClaimed) {
      throw new AppError(401, 'Token already used');
    }

    let payload: { id: string };
    try {
      payload = verifyTempToken(temp_token);
    } catch {
      throw new AppError(401, 'Invalid or expired temporary token');
    }

    const user = await app.db('users').where({ id: payload.id, is_active: true }).first();
    if (!user) throw new AppError(401, 'User not found or deactivated');

    if (!user.totp_enabled || !user.backup_codes) {
      throw new AppError(400, '2FA is not enabled or no backup codes');
    }

    const normalizedCode = code.toUpperCase().trim();
    const codeIndex = user.backup_codes.indexOf(normalizedCode);

    if (codeIndex === -1) {
      throw new AppError(401, 'Invalid backup code');
    }

    // Remove used backup code
    const updatedCodes = [...user.backup_codes];
    updatedCodes.splice(codeIndex, 1);

    await app.db('users').where({ id: user.id }).update({
      backup_codes: updatedCodes,
      last_login_at: new Date(),
    });

    // Generate full tokens
    const userPayload: UserPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      is_superadmin: user.is_superadmin,
    };

    const accessToken = signAccessToken(userPayload);
    const refreshToken = signRefreshToken(user.id);

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await app.db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });

    logAudit(request, 'auth.login', 'user', user.id);

    const { password_hash: _, totp_secret: __, backup_codes: ___, ...sanitizedUser } = user;
    return { user: sanitizedUser, accessToken };
  });
}
