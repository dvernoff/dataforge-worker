import en from './en.json';
import ru from './ru.json';

const translations: Record<string, typeof en> = { en, ru };

export type Locale = 'en' | 'ru';

export function t(locale: Locale): typeof en {
  return translations[locale] ?? translations.en;
}

export function getLocaleFromUrl(url: URL): Locale {
  const [, lang] = url.pathname.split('/');
  if (lang === 'ru') return 'ru';
  return 'en';
}

export function getLocalizedPath(path: string, locale: Locale): string {
  if (locale === 'ru') return `/ru${path}`;
  return path;
}

export function getAlternatePath(path: string, locale: Locale): string {
  if (locale === 'ru') {
    return path.replace(/^\/ru/, '') || '/';
  }
  return `/ru${path}`;
}
