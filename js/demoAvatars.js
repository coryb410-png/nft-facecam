/* Two original starter avatars so the app works before you upload anything. */
(function () {
  const neonCat = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="fur" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="#b48cff"/><stop offset="1" stop-color="#5b2bd6"/></radialGradient>
    <radialGradient id="iris" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#d9fff9"/><stop offset=".45" stop-color="#22f0d0"/><stop offset="1" stop-color="#0a6b78"/></radialGradient>
    <linearGradient id="ear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5fd2"/><stop offset="1" stop-color="#7a39e6"/></linearGradient>
  </defs>
  <path d="M120 200 L95 50 L230 135 Z" fill="url(#fur)"/><path d="M128 170 L112 82 L200 140 Z" fill="url(#ear)"/>
  <path d="M392 200 L417 50 L282 135 Z" fill="url(#fur)"/><path d="M384 170 L400 82 L312 140 Z" fill="url(#ear)"/>
  <ellipse cx="256" cy="275" rx="180" ry="165" fill="url(#fur)"/>
  <ellipse cx="256" cy="330" rx="105" ry="80" fill="#e9dcff" opacity=".9"/>
  <path d="M150 205 Q190 185 228 205" stroke="#2b0f6e" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M284 205 Q322 185 362 205" stroke="#2b0f6e" stroke-width="9" fill="none" stroke-linecap="round"/>
  <ellipse cx="190" cy="252" rx="40" ry="32" fill="#fff"/><ellipse cx="322" cy="252" rx="40" ry="32" fill="#fff"/>
  <circle cx="190" cy="254" r="24" fill="url(#iris)"/><circle cx="322" cy="254" r="24" fill="url(#iris)"/>
  <ellipse cx="190" cy="255" rx="7" ry="15" fill="#06161c"/><ellipse cx="322" cy="255" rx="7" ry="15" fill="#06161c"/>
  <circle cx="198" cy="244" r="6" fill="#fff"/><circle cx="330" cy="244" r="6" fill="#fff"/>
  <path d="M244 300 L268 300 L256 314 Z" fill="#ff4fa8"/>
  <path d="M256 314 L256 332 M222 344 Q240 356 256 340 Q272 356 290 344" stroke="#2b0f6e" stroke-width="7" fill="none" stroke-linecap="round"/>
  <g stroke="#e9dcff" stroke-width="4" stroke-linecap="round" opacity=".85"><path d="M150 318 L72 300"/><path d="M150 334 L70 340"/><path d="M362 318 L440 300"/><path d="M362 334 L442 340"/></g>
  <path d="M200 120 L256 96 L312 120 L300 138 L212 138 Z" fill="#ffe14f" stroke="#ff9d2f" stroke-width="5"/>
</svg>`;

  const chromeBot = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef3ff"/><stop offset=".5" stop-color="#8f9bb8"/><stop offset="1" stop-color="#3b4460"/></linearGradient>
    <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18213d"/><stop offset="1" stop-color="#0a0f1f"/></linearGradient>
    <radialGradient id="led" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#ff3df2"/><stop offset="1" stop-color="#6b0b8c"/></radialGradient>
  </defs>
  <rect x="246" y="38" width="20" height="60" rx="8" fill="#8f9bb8"/><circle cx="256" cy="36" r="18" fill="#3dfcff"/>
  <rect x="86" y="96" width="340" height="360" rx="92" fill="url(#metal)"/>
  <rect x="62" y="230" width="34" height="90" rx="14" fill="#5d6888"/><rect x="416" y="230" width="34" height="90" rx="14" fill="#5d6888"/>
  <rect x="122" y="180" width="268" height="130" rx="58" fill="url(#visor)" stroke="#3dfcff" stroke-width="5"/>
  <circle cx="190" cy="242" r="34" fill="url(#led)"/><circle cx="322" cy="242" r="34" fill="url(#led)"/>
  <circle cx="200" cy="232" r="8" fill="#fff"/><circle cx="332" cy="232" r="8" fill="#fff"/>
  <rect x="182" y="342" width="148" height="44" rx="20" fill="#1a213a" stroke="#3dfcff" stroke-width="4"/>
  <g stroke="#3dfcff" stroke-width="4" opacity=".8"><path d="M212 348 V380"/><path d="M240 348 V380"/><path d="M272 348 V380"/><path d="M300 348 V380"/></g>
  <path d="M140 140 Q256 110 372 140" stroke="#fff" stroke-width="7" fill="none" opacity=".6" stroke-linecap="round"/>
</svg>`;

  const s = 512;
  FC.demoAvatars = [
    {
      id: 'demo-neon-cat', name: 'Neon Cat', kind: 'image', builtin: true,
      svg: neonCat, removeBg: false, lidColor: '#8a5cf0',
      points: { eL: [190 / s, 252 / s], eR: [322 / s, 252 / s], m: [256 / s, 344 / s], erx: 44 / s, ery: 34 / s, mw: 40 / s }
    },
    {
      id: 'demo-chrome-bot', name: 'Chrome Bot', kind: 'image', builtin: true,
      svg: chromeBot, removeBg: false, lidColor: '#141b33',
      points: { eL: [190 / s, 242 / s], eR: [322 / s, 242 / s], m: [256 / s, 364 / s], erx: 38 / s, ery: 36 / s, mw: 72 / s }
    }
  ];
})();
