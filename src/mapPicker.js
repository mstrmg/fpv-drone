// Start-of-game map menu. Shared boot UI (not part of the sim or the visuals).
// Mouse click, keys 1..9 / arrows + Enter, or PS5 D-pad + Cross.
export function pickMap(uiRoot, levels) {
  return new Promise((resolve) => {
    let sel = 0;
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0b0d0c;color:#d8dccf;font:14px/1.4 ui-monospace,Menlo,Consolas,monospace;pointer-events:auto;z-index:10;';
    root.innerHTML = '<div style="letter-spacing:.4em;font-size:12px;opacity:.6;margin-bottom:8px">SELECT MAP</div>';
    const rows = levels.map((l, i) => {
      const row = document.createElement('button');
      row.style.cssText = 'all:unset;cursor:pointer;width:min(440px,86vw);padding:10px 14px;border:1px solid #3a4038;border-radius:3px;';
      row.innerHTML = `<div style="font-size:16px;letter-spacing:.12em">${i + 1}. ${l.name.toUpperCase()}</div><div style="opacity:.6;font-size:12px">${l.blurb ?? ''}</div>`;
      row.onmouseenter = () => { sel = i; paint(); };
      row.onclick = () => done(i);
      root.appendChild(row);
      return row;
    });
    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.45;font-size:11px;margin-top:10px';
    hint.textContent = 'click, 1–9, ↑↓ + Enter, or D-pad + ✕';
    root.appendChild(hint);
    uiRoot.appendChild(root);

    function paint() { rows.forEach((r, i) => { r.style.background = i === sel ? '#1d231c' : ''; r.style.borderColor = i === sel ? '#9fb08a' : '#3a4038'; }); }
    paint();
    const move = (d) => { sel = (sel + d + levels.length) % levels.length; paint(); };
    const onKey = (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= levels.length) done(n - 1);
      else if (e.code === 'ArrowDown') move(1);
      else if (e.code === 'ArrowUp') move(-1);
      else if (e.code === 'Enter' || e.code === 'Space') done(sel);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    let prev = [], raf = 0;
    const pollPad = () => {
      const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
      if (pad) {
        const now = pad.buttons.map((b) => b.pressed);
        const edge = (i) => now[i] && !prev[i];
        if (edge(13)) move(1);
        if (edge(12)) move(-1);
        if (edge(0)) return done(sel);
        prev = now;
      }
      raf = requestAnimationFrame(pollPad);
    };
    raf = requestAnimationFrame(pollPad);

    function done(i) {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      root.remove();
      resolve(levels[i].id);
    }
  });
}
