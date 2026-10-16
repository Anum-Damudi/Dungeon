/**
 * DUNGEON - Animated Rune Portal
 * Canvas-based mystical portal featuring rotating glyph ring, pulsing core, and ember particles.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const portalModule = factory();
    root.initPortal = portalModule.initPortal;
    root.destroyPortal = portalModule.destroyPortal;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ'];
  const EMBER_COLORS = ['#ff6b35', '#f39c12', '#e74c3c', '#ffd166', '#ff8c42'];

  let canvas = null;
  let ctx = null;
  let animId = null;
  let isRunning = false;
  let particles = [];
  let rotationAngle = 0;
  let pulsePhase = 0;
  let width = 300;
  let height = 300;
  let dpr = 1;

  /**
   * Particle constructor for glowing embers floating up from the portal.
   */
  class Particle {
    constructor(cx, cy, radius) {
      this.reset(cx, cy, radius);
    }

    reset(cx, cy, radius) {
      // Spawn near the core or inside the ring
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (radius * 0.85);
      this.x = cx + Math.cos(angle) * dist;
      this.y = cy + Math.sin(angle) * dist;
      this.vx = (Math.random() - 0.5) * 0.6;
      this.vy = -(0.5 + Math.random() * 1.2); // upward float
      this.size = 1.2 + Math.random() * 2.4;
      this.alpha = 0.2 + Math.random() * 0.7;
      this.decay = 0.005 + Math.random() * 0.008;
      this.color = EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)];
    }

    update(cx, cy, radius) {
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
      if (this.alpha <= 0) {
        this.reset(cx, cy, radius);
      }
    }

    draw(context) {
      context.save();
      context.globalAlpha = Math.max(0, this.alpha);
      context.fillStyle = this.color;
      context.shadowColor = this.color;
      context.shadowBlur = 6;
      context.beginPath();
      context.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  /**
   * Draw the pulsing dark/maroon core and concentric arcane runes.
   */
  function drawCore(cx, cy, radius, pulseFactor) {
    // Outer glow / aura
    const outerAura = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.05);
    outerAura.addColorStop(0, 'rgba(74, 15, 29, 0.55)');   // maroon
    outerAura.addColorStop(0.5, 'rgba(40, 8, 16, 0.45)');
    outerAura.addColorStop(0.85, 'rgba(200, 164, 86, 0.12)'); // hint of gold
    outerAura.addColorStop(1, 'rgba(12, 7, 9, 0)');
    ctx.fillStyle = outerAura;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing inner vortex
    const coreRadius = (radius * 0.68) + Math.sin(pulseFactor) * 8;
    const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(10, coreRadius));
    coreGrad.addColorStop(0, '#0c0709'); // abyssal black center
    coreGrad.addColorStop(0.35, '#28060f');
    coreGrad.addColorStop(0.7, '#4a0f1d'); // maroon
    coreGrad.addColorStop(0.92, '#631828');
    coreGrad.addColorStop(1, 'rgba(74, 15, 29, 0)');

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(10, coreRadius), 0, Math.PI * 2);
    ctx.fill();

    // Concentric arcane circles
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 164, 86, 0.35)'; // gold
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dashed orbit
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(200, 164, 86, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    // Center focal ring
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(255, 107, 53, 0.4)'; // ember
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.35 + Math.sin(pulseFactor * 1.5) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the 12 rotating rune glyphs on the circular rim.
   */
  function drawGlyphs(cx, cy, glyphRadius, angleOffset) {
    ctx.save();
    ctx.font = '600 19px "Cinzel", "Cormorant Garamond", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c8a456'; // gold
    ctx.shadowColor = 'rgba(200, 164, 86, 0.85)';
    ctx.shadowBlur = 9;

    const count = RUNES.length;
    for (let i = 0; i < count; i++) {
      const runeAngle = angleOffset + (i * Math.PI * 2) / count;
      const gx = cx + Math.cos(runeAngle) * glyphRadius;
      const gy = cy + Math.sin(runeAngle) * glyphRadius;

      ctx.save();
      ctx.translate(gx, gy);
      // Tangential orientation with subtle radial inclination
      ctx.rotate(runeAngle + Math.PI / 2);
      ctx.fillText(RUNES[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Main render frame.
   */
  function renderFrame(isStatic = false) {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.44;
    const glyphRadius = radius * 0.86;

    // 1. Core and vortex
    drawCore(cx, cy, radius, pulsePhase);

    // 2. Ember particles (underneath or intertwined with glyphs)
    if (!isStatic) {
      for (let i = 0; i < particles.length; i++) {
        particles[i].update(cx, cy, radius);
        particles[i].draw(ctx);
      }
    }

    // 3. Rotating rune ring
    drawGlyphs(cx, cy, glyphRadius, rotationAngle);
  }

  /**
   * Animation loop.
   */
  function animate() {
    if (!isRunning) return;

    rotationAngle += 0.0035; // gentle, majestic rotation
    if (rotationAngle >= Math.PI * 2) {
      rotationAngle -= Math.PI * 2;
    }

    pulsePhase += 0.035; // breathing pulse (~1.8 second cycle)
    if (pulsePhase >= Math.PI * 2) {
      pulsePhase -= Math.PI * 2;
    }

    renderFrame(false);
    animId = requestAnimationFrame(animate);
  }

  /**
   * Initialize and start the portal animation on the target canvas.
   * Respects prefers-reduced-motion media query.
   */
  function initPortal(canvasId) {
    destroyPortal();

    const target = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!target || !(target instanceof HTMLCanvasElement)) {
      console.warn('[Portal] Canvas not found:', canvasId);
      return;
    }

    canvas = target;
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina / DPI scaling
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : (canvas.width || 300);
    const cssHeight = rect.height > 0 ? rect.height : (canvas.height || 300);

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.scale(dpr, dpr);

    width = cssWidth;
    height = cssHeight;

    // Spawn initial particle pool
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.44;
    particles = [];
    const particleCount = 26;
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle(cx, cy, radius));
    }

    // Check for prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      rotationAngle = 0;
      pulsePhase = 0;
      renderFrame(true);
      return;
    }

    isRunning = true;
    animId = requestAnimationFrame(animate);
  }

  /**
   * Stop the animation loop and release resources.
   */
  function destroyPortal() {
    isRunning = false;
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, width, height);
    }
    particles = [];
    canvas = null;
    ctx = null;
  }

  return {
    initPortal: initPortal,
    destroyPortal: destroyPortal
  };
});
