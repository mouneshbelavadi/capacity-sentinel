// Palette Validator for RackSense Categorical Hues
// Evaluates Delta E, Contrast against surfaces, and Color Vision Deficiency (CVD) simulation

const hues = [
  { name: '--cat-1', hex: '#1F5FA6' },
  { name: '--cat-2', hex: '#B5457F' },
  { name: '--cat-3', hex: '#0E7C7B' },
  { name: '--cat-4', hex: '#6B4FA0' },
  { name: '--cat-5', hex: '#44576B' },
];

function hexToRgb(hex) {
  const num = parseInt(hex.replace('#', ''), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToXyz([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  return [x * 100, y * 100, z * 100];
}

function xyzToLab([x, y, z]) {
  const xn = 95.047;
  const yn = 100.0;
  const zn = 108.883;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz)
  ];
}

function f(t) {
  return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116;
}

function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

// CIE76 Delta E
function deltaE76(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1[0] - lab2[0], 2) +
    Math.pow(lab1[1] - lab2[1], 2) +
    Math.pow(lab1[2] - lab2[2], 2)
  );
}

// Relative luminance for WCAG contrast
function getLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrast(hex1, hex2) {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Brettel / Vienot CVD simulation matrices
const CVD_MATRICES = {
  protanopia: [
    [0.56667, 0.43333, 0],
    [0.55833, 0.44167, 0],
    [0, 0.24167, 0.75833]
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7]
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.43333, 0.56667],
    [0, 0.475, 0.525]
  ]
};

function simulateCVD([r, g, b], type) {
  const m = CVD_MATRICES[type];
  const nr = Math.min(255, Math.max(0, m[0][0]*r + m[0][1]*g + m[0][2]*b));
  const ng = Math.min(255, Math.max(0, m[1][0]*r + m[1][1]*g + m[1][2]*b));
  const nb = Math.min(255, Math.max(0, m[2][0]*r + m[2][1]*g + m[2][2]*b));
  return [Math.round(nr), Math.round(ng), Math.round(nb)];
}

console.log('================================================================');
console.log('            RACK-SENSE PALETTE VALIDATION REPORT                ');
console.log('================================================================');
console.log('Tested categorical palette:');
hues.forEach((h, i) => {
  const contrastSurface = getContrast(h.hex, '#FFFFFF').toFixed(2);
  const contrastCanvas = getContrast(h.hex, '#F5F6F8').toFixed(2);
  console.log(`  [${i + 1}] ${h.name.padEnd(8)} : ${h.hex} | Contrast vs Surface (#FFF): ${contrastSurface}:1 | vs Canvas: ${contrastCanvas}:1`);
});

console.log('\n--- ADJACENT PAIR SEPARATION (Minimum ΔE target ≥ 15) ---');
let allAdjacentPass = true;
for (let i = 0; i < hues.length - 1; i++) {
  const h1 = hues[i];
  const h2 = hues[i + 1];
  const rgb1 = hexToRgb(h1.hex);
  const rgb2 = hexToRgb(h2.hex);
  
  const lab1 = rgbToLab(rgb1);
  const lab2 = rgbToLab(rgb2);
  const de = deltaE76(lab1, lab2);

  // CVD checks
  const deProtan = deltaE76(rgbToLab(simulateCVD(rgb1, 'protanopia')), rgbToLab(simulateCVD(rgb2, 'protanopia')));
  const deDeuteran = deltaE76(rgbToLab(simulateCVD(rgb1, 'deuteranopia')), rgbToLab(simulateCVD(rgb2, 'deuteranopia')));
  const deTritan = deltaE76(rgbToLab(simulateCVD(rgb1, 'tritanopia')), rgbToLab(simulateCVD(rgb2, 'tritanopia')));

  const passNormal = de >= 15;
  const passCvd = Math.min(deProtan, deDeuteran, deTritan) >= 10;
  const pairPass = passNormal && passCvd;
  if (!pairPass) allAdjacentPass = false;

  console.log(`\nPair (${h1.name} ↔ ${h2.name}): [${h1.hex} ↔ ${h2.hex}]`);
  console.log(`  Normal Vision ΔE  : ${de.toFixed(1)} ${de >= 15 ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Protanopia ΔE     : ${deProtan.toFixed(1)} ${deProtan >= 10 ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Deuteranopia ΔE   : ${deDeuteran.toFixed(1)} ${deDeuteran >= 10 ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Tritanopia ΔE     : ${deTritan.toFixed(1)} ${deTritan >= 10 ? '[PASS]' : '[FAIL]'}`);
  console.log(`  Overall Status    : ${pairPass ? 'PASS' : 'FAIL'}`);
}

// Also check status hues vs categorical hues to ensure no collision
console.log('\n--- STATUS vs CATEGORICAL COLLISION CHECK ---');
const statusHues = [
  { name: '--ok', hex: '#1E8E3E' },
  { name: '--warn', hex: '#C77700' },
  { name: '--crit', hex: '#C5221F' },
  { name: '--offline', hex: '#80868B' }
];

let noStatusCollision = true;
statusHues.forEach(st => {
  hues.forEach(cat => {
    const de = deltaE76(rgbToLab(hexToRgb(st.hex)), rgbToLab(hexToRgb(cat.hex)));
    if (de < 12) {
      console.log(`  WARNING: Low separation between status ${st.name} (${st.hex}) and ${cat.name} (${cat.hex}): ΔE=${de.toFixed(1)}`);
      noStatusCollision = false;
    }
  });
});

if (noStatusCollision) {
  console.log('  No status vs categorical collisions (all ΔE ≥ 12). Separation verified.');
}

console.log('\n================================================================');
console.log(`PALETTE VALIDATION RESULT: ${allAdjacentPass && noStatusCollision ? 'ALL CHECKS PASSED' : 'CHECK FAILED'}`);
console.log('================================================================\n');
