import { readFileSync } from 'node:fs';

interface AnalyticsConfig { gameKey?: string; secretKey?: string; adminUserIds?: string[]; }
/** Only the server reads collection credentials and the dashboard account allowlist. */
let config: AnalyticsConfig = {};
try {
  if (process.env.ANALYTICS_CONFIG) {
    const input = JSON.parse(readFileSync(process.env.ANALYTICS_CONFIG, 'utf8'));
    if (input && typeof input === 'object' && !Array.isArray(input)) config = {
      gameKey: typeof input.gameKey === 'string' ? input.gameKey : '',
      secretKey: typeof input.secretKey === 'string' ? input.secretKey : '',
      adminUserIds: Array.isArray(input.adminUserIds) ? input.adminUserIds.filter((id: unknown) => typeof id === 'string') : [],
    };
  }
} catch { console.error('Analytics configuration could not be loaded.'); }
export const analyticsConfig = {
  gameKey: /^[a-f0-9]{32}$/.test(config.gameKey ?? '') ? config.gameKey! : '',
  secretKey: /^[a-f0-9]{32,64}$/.test(config.secretKey ?? '') ? config.secretKey! : '',
  adminUserIds: new Set((config.adminUserIds ?? []).filter(id => /^[a-f0-9-]{36}$/.test(id))),
};
export const gameAnalyticsConfigured = () => Boolean(analyticsConfig.gameKey && analyticsConfig.secretKey);
