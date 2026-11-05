/*
  IO Tester — menu laterale / side menu
  IT: Unica definizione del menu per tutte le pagine. Su PC il menu è fisso a sinistra; su telefono
      si apre con il pulsante ☰ e si chiude toccando fuori, con Esc o scegliendo una pagina.
      Per aggiungere una pagina: una riga in NAV (href = null → "Presto", non cliccabile).
  EN: Single menu definition for every page. On PC the menu is fixed on the left; on phones it
      opens with the ☰ button and closes by tapping outside, with Esc or by choosing a page.
      To add a page: one line in NAV (href = null → "Soon", not clickable).
*/
'use strict';

const NAV = [
  { href: '/', key: 'nav_home', icon: 'ic-home', cat: 'tool' },
  { group: 'grp_gen' },
  { href: 'gen-v.html', key: 'fn_voltage', icon: 'ic-volt', cat: 'gen' },
  { href: 'gen-i.html', key: 'fn_current', icon: 'ic-amp', cat: 'gen' },
  { href: 'sim.html', key: 'fn_sim', icon: 'ic-loop', cat: 'loop' },
  { group: 'grp_meas' },
  { href: 'meas-v.html', key: 'fn_voltage', icon: 'ic-gauge', cat: 'meas' },
  { href: 'meas-i4.html', key: 'fn_cur_4w', icon: 'ic-pulse', cat: 'meas' },
  { href: 'meas-i2.html', key: 'fn_cur_2w', icon: 'ic-plug', cat: 'meas' },
  { group: 'grp_test' },
  { href: 'prove.html', key: 'fn_tests', icon: 'ic-steps', cat: 'test' },
  { href: 'pid.html', key: 'fn_pid', icon: 'ic-pid', cat: 'test' },
  { group: 'grp_tool' },
  { href: 'cal.html', key: 'fn_cal', icon: 'ic-target', cat: 'tool' },
  { href: 'autotest.html', key: 'fn_autotest', icon: 'ic-check', cat: 'tool' },
  { href: 'diag.html', key: 'fn_diag', icon: 'ic-chip', cat: 'tool' },
  { href: 'collaudo.html', key: 'fn_bench', icon: 'ic-tool', cat: 'tool' },
  { href: 'info.html', key: 'fn_info', icon: 'ic-info', cat: 'tool' },
];

/**
 * IT: true se la voce corrisponde alla pagina aperta. EN: true if the item matches the open page.
 */
function isCurrent(href) {
  const path = location.pathname;
  if (href === '/') return path === '/' || path.endsWith('/index.html');
  return path.endsWith(href.replace(/^\//, ''));
}

/**
 * IT: Costruisce il menu dentro <nav id="sidenav"> (i testi vengono tradotti da applyI18n()).
 * EN: Builds the menu inside <nav id="sidenav"> (texts are translated by applyI18n()).
 */
function buildNav() {
  const nav = document.getElementById('sidenav');
  if (!nav) return;
  const icons = 'img/icons.svg';
  let html = `
    <div class="nav-head">
      <img class="logo" src="img/icon.svg" alt=""><span class="brand-name">IO Tester</span>
      <button id="btn-nav-close" class="icon-btn" type="button" data-i18n-title="nav_close">
        <svg class="icon"><use href="${icons}#ic-close"/></svg>
      </button>
    </div>`;
  for (const item of NAV) {
    if (item.group) {
      html += `<div class="nav-group" data-i18n="${item.group}"></div>`;
      continue;
    }
    const cls = `nav-item cat-${item.cat}${item.href ? '' : ' soon'}${item.href && isCurrent(item.href) ? ' active' : ''}`;
    const attrs = item.href ? `href="${item.href}"` : 'aria-disabled="true"';
    html += `<a class="${cls}" ${attrs}>
        <span class="nav-ico"><svg class="icon"><use href="${icons}#${item.icon}"/></svg></span>
        <span class="nav-text" data-i18n="${item.key}"></span>
        ${item.href ? '' : '<span class="soon-badge" data-i18n="soon"></span>'}
      </a>`;
  }
  nav.innerHTML = html;

  $('btn-nav-close').addEventListener('click', () => toggleNav(false));
  nav.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', () => toggleNav(false)));
  const menuBtn = $('btn-menu');
  if (menuBtn) menuBtn.addEventListener('click', () => toggleNav(true));
  const backdrop = $('nav-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => toggleNav(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleNav(false); });
}

/**
 * IT: Apre (true) o chiude (false) il menu su telefono. EN: Opens (true) or closes (false) the menu on phones.
 */
function toggleNav(open) {
  document.body.classList.toggle('nav-open', open);
  const btn = $('btn-menu');
  if (btn) btn.setAttribute('aria-expanded', String(open));
}
