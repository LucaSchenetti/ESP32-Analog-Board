/*
  IO Tester — tema chiaro / scuro / light / dark theme
  IT: Caricato nell'<head> SENZA defer, così il tema è applicato prima del disegno (niente lampeggio).
      Scelta iniziale = tema del sistema; poi resta salvata nel browser.
  EN: Loaded in <head> WITHOUT defer, so the theme is applied before painting (no flash).
      Initial choice = system theme; then it is remembered in the browser.
*/
'use strict';

const THEME_KEY = 'iotester.theme';

/**
 * IT: Tema attuale: quello salvato, altrimenti quello del sistema operativo.
 * EN: Current theme: the saved one, otherwise the operating-system preference.
 */
function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (e) { /* IT: memoria del browser non disponibile / EN: browser storage unavailable */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * IT: Applica il tema alla pagina (attributo data-theme su <html>).
 * EN: Applies the theme to the page (data-theme attribute on <html>).
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0b1220' : '#f3f5f9';
  // IT: nell'app Android adegua barra di stato e tasti di Android / EN: in the Android app, adapts status bar and Android buttons
  if (window.IOTesterApp) window.IOTesterApp.setTheme(theme === 'dark');
}

/**
 * IT: Passa da chiaro a scuro e viceversa, salvando la scelta.
 * EN: Switches between light and dark, saving the choice.
 */
function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* IT/EN: vedi sopra / see above */ }
  applyTheme(next);
}

applyTheme(getTheme());
