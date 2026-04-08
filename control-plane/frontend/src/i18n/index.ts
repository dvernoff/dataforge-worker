import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enTables from './locales/en/tables.json';
import enData from './locales/en/data.json';
import enApi from './locales/en/api.json';
import enWebhooks from './locales/en/webhooks.json';
import enSql from './locales/en/sql.json';
import enAudit from './locales/en/audit.json';
import enSettings from './locales/en/settings.json';
import enSystem from './locales/en/system.json';
import enNodes from './locales/en/nodes.json';
import enAnalytics from './locales/en/analytics.json';
import enExplorer from './locales/en/explorer.json';
import enCron from './locales/en/cron.json';
import enPlugins from './locales/en/plugins.json';
import enDashboards from './locales/en/dashboards.json';
import enDocs from './locales/en/docs.json';
import enSboxAuth from './locales/en/sbox-auth.json';

import ruCommon from './locales/ru/common.json';
import ruAuth from './locales/ru/auth.json';
import ruDashboard from './locales/ru/dashboard.json';
import ruTables from './locales/ru/tables.json';
import ruData from './locales/ru/data.json';
import ruApi from './locales/ru/api.json';
import ruWebhooks from './locales/ru/webhooks.json';
import ruSql from './locales/ru/sql.json';
import ruAudit from './locales/ru/audit.json';
import ruSettings from './locales/ru/settings.json';
import ruSystem from './locales/ru/system.json';
import ruNodes from './locales/ru/nodes.json';
import ruAnalytics from './locales/ru/analytics.json';
import ruExplorer from './locales/ru/explorer.json';
import ruCron from './locales/ru/cron.json';
import ruPlugins from './locales/ru/plugins.json';
import ruDashboards from './locales/ru/dashboards.json';
import ruDocs from './locales/ru/docs.json';
import ruSboxAuth from './locales/ru/sbox-auth.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        tables: enTables,
        data: enData,
        api: enApi,
        webhooks: enWebhooks,
        sql: enSql,
        audit: enAudit,
        settings: enSettings,
        system: enSystem,
        nodes: enNodes,
        analytics: enAnalytics,
        explorer: enExplorer,
        cron: enCron,
        plugins: enPlugins,
        dashboards: enDashboards,
        docs: enDocs,
        'sbox-auth': enSboxAuth,
      },
      ru: {
        common: ruCommon,
        auth: ruAuth,
        dashboard: ruDashboard,
        tables: ruTables,
        data: ruData,
        api: ruApi,
        webhooks: ruWebhooks,
        sql: ruSql,
        audit: ruAudit,
        settings: ruSettings,
        system: ruSystem,
        nodes: ruNodes,
        analytics: ruAnalytics,
        explorer: ruExplorer,
        cron: ruCron,
        plugins: ruPlugins,
        dashboards: ruDashboards,
        docs: ruDocs,
        'sbox-auth': ruSboxAuth,
      },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'auth', 'dashboard', 'tables', 'data', 'api', 'webhooks', 'sql', 'audit', 'settings', 'system', 'nodes', 'analytics', 'explorer', 'cron', 'plugins', 'dashboards', 'docs', 'sbox-auth'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'dataforge-lang',
      cacheUserLanguage: true,
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
