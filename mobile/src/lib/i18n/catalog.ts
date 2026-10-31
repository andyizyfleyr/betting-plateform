/** Internationalisation en cours de déploiement. Une langue n'est publiée
 * qu'après traduction complète des parcours financiers et tests web/Android. */
export const LANGUAGE_NAMES = {
  fr: "Français", en: "English", es: "Español", pt: "Português",
  de: "Deutsch", it: "Italiano", nl: "Nederlands", ar: "العربية",
} as const;
export type Language = keyof typeof LANGUAGE_NAMES;
export type Direction = "ltr" | "rtl";
export const DEFAULT_LANGUAGE: Language = "fr";
// Ne pas activer une langue partielle dans les parcours de paiement ou de pari.
export const RELEASED_LANGUAGES: readonly Language[] = ["fr"];
export const LANGUAGE_STORAGE_KEY = "pulsebet.language.v1";

// Une préférence de langue est indépendante du pays et de la devise verrouillés.
// Ces suggestions ne sont jamais imposées au joueur et ne sont pas une liste
// exhaustive des langues parlées dans un pays multilingue.
const COUNTRY_SUGGESTIONS: Readonly<Record<string, readonly Language[]>> = {
  BJ:["fr"], CI:["fr"], SN:["fr"], TG:["fr"], BF:["fr"], ML:["fr"], NE:["fr"],
  GW:["pt"], CM:["fr","en"], GA:["fr"], CG:["fr"], TD:["fr","ar"], CF:["fr"],
  GQ:["es","fr","pt"], CD:["fr"], GN:["fr"], MA:["ar","fr"], DZ:["ar","fr"],
  TN:["ar","fr"], NG:["en"], GH:["en"], KE:["en"], RW:["en","fr"], MG:["fr"],
  ZA:["en"], EG:["ar","en"], FR:["fr"], BE:["fr","nl","de"], CH:["fr","de","it"],
  LU:["fr","de"], DE:["de"], ES:["es"], IT:["it"], PT:["pt"], NL:["nl"],
  IE:["en"], GB:["en"], CA:["fr","en"], US:["en"],
};
export function suggestedLanguagesForCountry(country: string): readonly Language[] {
  return COUNTRY_SUGGESTIONS[country.trim().toUpperCase()] ?? [DEFAULT_LANGUAGE];
}
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, value);
}
export function isReleasedLanguage(value: unknown): value is Language {
  return isLanguage(value) && RELEASED_LANGUAGES.includes(value);
}
export function resolveReleasedLanguage(value: unknown): Language {
  return isReleasedLanguage(value) ? value : DEFAULT_LANGUAGE;
}
export function languageDirection(language: Language): Direction {
  return language === "ar" ? "rtl" : "ltr";
}

// Première section du catalogue commun ; les clés métiers, juridiques, erreurs API,
// notifications et contenus dynamiques sont à traduire avant publication.
const messages = {
  fr: { matches:"Matchs", predictions:"Prédictions", betslip:"Betslip", myBets:"Mes paris", account:"Compte", mainNavigation:"Navigation principale", language:"Langue", emailAddress:"Adresse e-mail", password:"Mot de passe", forgotPassword:"Mot de passe oublié ?", signIn:"Se connecter" },
  en: { matches:"Matches", predictions:"Predictions", betslip:"Betslip", myBets:"My bets", account:"Account", mainNavigation:"Main navigation", language:"Language", emailAddress:"Email address", password:"Password", forgotPassword:"Forgot password?", signIn:"Sign in" },
  es: { matches:"Partidos", predictions:"Predicciones", betslip:"Boleto", myBets:"Mis apuestas", account:"Cuenta", mainNavigation:"Navegación principal", language:"Idioma", emailAddress:"Correo electrónico", password:"Contraseña", forgotPassword:"¿Olvidaste tu contraseña?", signIn:"Iniciar sesión" },
  pt: { matches:"Jogos", predictions:"Previsões", betslip:"Boletim", myBets:"Minhas apostas", account:"Conta", mainNavigation:"Navegação principal", language:"Idioma", emailAddress:"Endereço de e-mail", password:"Palavra-passe", forgotPassword:"Esqueceu a palavra-passe?", signIn:"Iniciar sessão" },
  de: { matches:"Spiele", predictions:"Prognosen", betslip:"Wettschein", myBets:"Meine Wetten", account:"Konto", mainNavigation:"Hauptnavigation", language:"Sprache", emailAddress:"E-Mail-Adresse", password:"Passwort", forgotPassword:"Passwort vergessen?", signIn:"Anmelden" },
  it: { matches:"Partite", predictions:"Pronostici", betslip:"Schedina", myBets:"Le mie scommesse", account:"Conto", mainNavigation:"Navigazione principale", language:"Lingua", emailAddress:"Indirizzo email", password:"Password", forgotPassword:"Password dimenticata?", signIn:"Accedi" },
  nl: { matches:"Wedstrijden", predictions:"Voorspellingen", betslip:"Weddenschapsbriefje", myBets:"Mijn weddenschappen", account:"Account", mainNavigation:"Hoofdnavigatie", language:"Taal", emailAddress:"E-mailadres", password:"Wachtwoord", forgotPassword:"Wachtwoord vergeten?", signIn:"Inloggen" },
  ar: { matches:"المباريات", predictions:"التوقعات", betslip:"قسيمة الرهان", myBets:"رهاناتي", account:"الحساب", mainNavigation:"التنقل الرئيسي", language:"اللغة", emailAddress:"البريد الإلكتروني", password:"كلمة المرور", forgotPassword:"هل نسيت كلمة المرور؟", signIn:"تسجيل الدخول" },
} satisfies Record<Language, Record<string, string>>;
export type MessageKey = keyof typeof messages.fr;
export function translate(language: Language, key: MessageKey): string {
  return messages[language][key] ?? messages[DEFAULT_LANGUAGE][key];
}
