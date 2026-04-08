import type { Knex } from 'knex';
import { hashPassword, comparePassword } from '../../utils/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt.utils.js';
import { AppError } from '../../middleware/error-handler.js';
import type { UserPayload } from '../../../../../shared/types/auth.types.js';
import bcrypt from 'bcrypt';

interface RegisterParams {
  email: string;
  password: string;
  name: string;
  inviteKey?: string;
}

export class AuthService {
  constructor(private db: Knex) {}

  async register({ email, password, name, inviteKey }: RegisterParams) {
    let requireInvite = true;
    try {
      const hasSettings = await this.db.schema.hasTable('system_settings');
      if (hasSettings) {
        const setting = await this.db('system_settings').where({ key: 'require_invite' }).first();
        if (setting?.value === 'false') requireInvite = false;
      }
    } catch { /* default to require */ }

    let invite: Record<string, unknown> | null = null;

    if (inviteKey) {
      invite = await this.db('invite_keys')
        .where({ key: inviteKey, is_active: true })
        .first() ?? null;

      if (!invite) {
        throw new AppError(400, 'Invalid or inactive invite key');
      }

      if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
        throw new AppError(400, 'Invite key has expired');
      }

      if ((invite.max_uses as number) > 0 && (invite.current_uses as number) >= (invite.max_uses as number)) {
        throw new AppError(400, 'Invite key has reached maximum uses');
      }
    } else if (requireInvite) {
      throw new AppError(400, 'Invite key is required');
    }

    const existing = await this.db('users').where({ email }).first();
    if (existing) {
      throw new AppError(409, 'User with this email already exists');
    }

    const passwordHash = await hashPassword(password);

    const result = await this.db.transaction(async (trx) => {
      const [user] = await trx('users')
        .insert({
          email,
          password_hash: passwordHash,
          name,
        })
        .returning('*');

      if (invite) {
        if (invite.project_id) {
          await trx('project_members').insert({
            project_id: invite.project_id,
            user_id: user.id,
            role: invite.role,
          });
        }

        await trx('invite_keys')
          .where({ id: invite.id })
          .increment('current_uses', 1);

        if ((invite.max_uses as number) > 0 && (invite.current_uses as number) + 1 >= (invite.max_uses as number)) {
          await trx('invite_keys')
            .where({ id: invite.id })
            .update({ is_active: false });
        }
      }

      // Assign default role if configured
      try {
        const hasRoleId = await trx.schema.hasColumn('users', 'role_id');
        const hasSettings = await trx.schema.hasTable('system_settings');
        if (hasRoleId && hasSettings) {
          const setting = await trx('system_settings').where({ key: 'default_role' }).first();
          if (setting?.value && setting.value.length > 10) {
            // Looks like a UUID — verify role exists
            const hasRoles = await trx.schema.hasTable('custom_roles');
            if (hasRoles) {
              const role = await trx('custom_roles').where({ id: setting.value }).first();
              if (role) {
                await trx('users').where({ id: user.id }).update({ role_id: setting.value });
              }
            }
          }
        }
      } catch { /* default role assignment is best-effort */ }

      return user;
    });

    const tokens = await this.generateTokens(result);
    return { user: this.sanitizeUser(result), ...tokens };
  }

  async login(email: string, password: string) {
    const user = await this.db('users').where({ email }).first();
    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    if (!user.is_active) {
      throw new AppError(403, 'Account is deactivated');
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password');
    }

    await this.db('users').where({ id: user.id }).update({ last_login_at: new Date() });

    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async refresh(refreshTokenValue: string) {
    let payload: { id: string };
    try {
      payload = verifyRefreshToken(refreshTokenValue);
    } catch {
      throw new AppError(401, 'Invalid refresh token');
    }

    const storedTokens = await this.db('refresh_tokens')
      .where({ user_id: payload.id })
      .where('expires_at', '>', new Date());

    let tokenValid = false;
    for (const stored of storedTokens) {
      if (await bcrypt.compare(refreshTokenValue, stored.token_hash)) {
        tokenValid = true;
        await this.db('refresh_tokens').where({ id: stored.id }).delete();
        break;
      }
    }

    if (!tokenValid) {
      throw new AppError(401, 'Refresh token not found or expired');
    }

    const user = await this.db('users').where({ id: payload.id, is_active: true }).first();
    if (!user) {
      throw new AppError(401, 'User not found or deactivated');
    }

    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async logout(userId: string, refreshTokenValue?: string) {
    if (refreshTokenValue) {
      const storedTokens = await this.db('refresh_tokens').where({ user_id: userId });
      for (const stored of storedTokens) {
        if (await bcrypt.compare(refreshTokenValue, stored.token_hash)) {
          await this.db('refresh_tokens').where({ id: stored.id }).delete();
          break;
        }
      }
    } else {
      // Logout from all sessions
      await this.db('refresh_tokens').where({ user_id: userId }).delete();
    }
  }

  private async generateTokens(user: { id: string; email: string; name: string; is_superadmin: boolean }) {
    const userPayload: UserPayload = {
      id: user.id,
      email: user.email,
      name: user.name,
      is_superadmin: user.is_superadmin,
    };

    const accessToken = signAccessToken(userPayload);
    const refreshToken = signRefreshToken(user.id);

    // Store refresh token hash
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await this.db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: Record<string, unknown>) {
    const { password_hash: _, ...rest } = user;
    return rest;
  }
}
