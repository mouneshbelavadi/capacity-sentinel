import * as THREE from 'three';

/**
 * Generates a 45° diagonal hatch texture on a repeating 64x64 canvas.
 * This is used for foreign slots (status: UNKNOWN) in tenant scope,
 * ensuring they look unmistakably like "not shown" / "not data",
 * never like "fine" or "green" (shared/design-system.md §2).
 */
export function createHatchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Light neutral background (--surface-sunken #FAFBFC)
    ctx.fillStyle = '#FAFBFC';
    ctx.fillRect(0, 0, 64, 64);

    // 45° diagonal hatch lines in muted border color (--border #DADCE0)
    ctx.strokeStyle = '#DADCE0';
    ctx.lineWidth = 2.5;

    for (let offset = -64; offset <= 128; offset += 12) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + 64, 64);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.needsUpdate = true;

  return texture;
}

// Cached singleton to avoid re-creating textures
let cachedTexture: THREE.CanvasTexture | null = null;

export function getHatchTexture(): THREE.CanvasTexture {
  if (!cachedTexture && typeof document !== 'undefined') {
    cachedTexture = createHatchTexture();
  }
  return cachedTexture as THREE.CanvasTexture;
}
