import * as vscode from "vscode";
import { Locale } from "./types";
import { zh } from "./zh";
import { en } from "./en";

const bundles: Record<Locale, Record<string, string>> = { zh, en };
let currentLocale: Locale = "zh";
const listeners: Array<(locale: Locale) => void> = [];

export function initI18n(): void {
  const cfg = vscode.workspace.getConfiguration("jenkinsBatchTrigger");
  currentLocale = (cfg.get<string>("language") as Locale) || "zh";
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const fn of listeners) fn(locale);
}

export function onLocaleChange(fn: (locale: Locale) => void): vscode.Disposable {
  listeners.push(fn);
  return new vscode.Disposable(() => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  });
}

export function t(key: string, params?: Record<string, string | number>): string {
  const tpl = bundles[currentLocale][key] ?? bundles.zh[key] ?? key;
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, n) => String(params[n] ?? `{${n}}`));
}

export function getWebviewMessages(): Record<string, string> {
  const src = bundles[currentLocale];
  const out: Record<string, string> = {};
  for (const k of Object.keys(src)) {
    if (k.startsWith("webview.")) out[k] = src[k];
  }
  return out;
}
