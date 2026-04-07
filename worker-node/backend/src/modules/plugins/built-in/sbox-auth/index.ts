import type { Knex } from 'knex';
import { randomBytes } from 'crypto';

const FACEPUNCH_VALIDATE_URL = 'https://services.facepunch.com/sbox/auth/token';

interface SboxAuthConfig {
  service_name: string;
  session_table: string;
  steam_id_column: string;
  session_key_column: string;
}

interface SboxTokenResponse {
  SteamId: string;
  Created: string;
  Expired: string;
  IsExpired: boolean;
}

export class SboxAuthPlugin {
  constructor(private db: Knex) {}

  async handleLogin(
    schema: string,
    config: SboxAuthConfig,
    body: { token: string; extra?: Record<string, unknown> }
  ): Promise<{ session_key: string; steam_id: string; is_new_player: boolean }> {
    if (!body.token) {
      throw Object.assign(new Error('Token is required'), { statusCode: 400 });
    }

    const tokenData = await this.validateToken(body.token);

    if (!tokenData.SteamId) {
      throw Object.assign(new Error('Invalid token: no Steam ID returned'), { statusCode: 401 });
    }

    if (tokenData.IsExpired) {
      throw Object.assign(new Error('Token has expired'), { statusCode: 401 });
    }

    const steamId = tokenData.SteamId;
    const sessionKey = this.generateSessionKey();

    const tableName = schema ? `${schema}.${config.session_table}` : config.session_table;

    const existing = await this.db(tableName)
      .where(config.steam_id_column, steamId)
      .first();

    const allowedExtra: Record<string, unknown> = {};
    if (body.extra && typeof body.extra === 'object') {
      const systemFields = [config.steam_id_column, config.session_key_column, 'id', 'created_at', 'updated_at', 'is_admin', 'role', 'balance'];
      for (const [key, value] of Object.entries(body.extra)) {
        if (!systemFields.includes(key) && /^[a-z_][a-z0-9_]*$/.test(key)) {
          allowedExtra[key] = value;
        }
      }
    }

    if (existing) {
      await this.db(tableName)
        .where(config.steam_id_column, steamId)
        .update({
          [config.session_key_column]: sessionKey,
          last_login_at: new Date().toISOString(),
          ...allowedExtra,
        });

      return { session_key: sessionKey, steam_id: steamId, is_new_player: false };
    }

    await this.db(tableName)
      .insert({
        [config.steam_id_column]: steamId,
        [config.session_key_column]: sessionKey,
        last_login_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        ...allowedExtra,
      });

    return { session_key: sessionKey, steam_id: steamId, is_new_player: true };
  }

  async handleSessionCheck(
    schema: string,
    config: SboxAuthConfig,
    sessionKey: string
  ): Promise<Record<string, unknown> | null> {
    if (!sessionKey) {
      throw Object.assign(new Error('Session key is required'), { statusCode: 400 });
    }

    const tableName = schema ? `${schema}.${config.session_table}` : config.session_table;

    const player = await this.db(tableName)
      .where(config.session_key_column, sessionKey)
      .first();

    if (!player) {
      return null;
    }

    const { [config.session_key_column]: _sessionKey, ...playerData } = player;
    return playerData;
  }

  async handleLogout(
    schema: string,
    config: SboxAuthConfig,
    sessionKey: string
  ): Promise<boolean> {
    if (!sessionKey) {
      throw Object.assign(new Error('Session key is required'), { statusCode: 400 });
    }

    const tableName = schema ? `${schema}.${config.session_table}` : config.session_table;

    const updated = await this.db(tableName)
      .where(config.session_key_column, sessionKey)
      .update({ [config.session_key_column]: null });

    return updated > 0;
  }

  private async validateToken(token: string): Promise<SboxTokenResponse> {
    try {
      const response = await fetch(FACEPUNCH_VALIDATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Facepunch API returned ${response.status}: ${text}`);
      }

      const data = (await response.json()) as SboxTokenResponse;
      return data;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Facepunch API')) {
        throw Object.assign(err, { statusCode: 502 });
      }
      throw Object.assign(
        new Error(`Failed to validate token: ${err instanceof Error ? err.message : String(err)}`),
        { statusCode: 502 }
      );
    }
  }

  private generateSessionKey(): string {
    return randomBytes(32).toString('hex');
  }
}
