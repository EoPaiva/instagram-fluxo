(() => {
  'use strict';

  // Adapted from the author's original upaiva.dev/site.js: initHeroCanvas and
  // initAmbient's mPaiva_ sampling, spring repulsion and travelling highlight.
  // Visuals only. No Instagram, provider, tracking or extension storage APIs.
  const installed = 'instagramFluxoBrandMotion';
  if (globalThis[installed]) return;
  globalThis[installed] = true;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const preferenceKey = 'instagramFluxoBrandMotionPaused';
  const stages = [];
  const wordmarkAnimations = [];
  let userPaused = false;
  let pageSuspended = false;
  try { userPaused = localStorage.getItem(preferenceKey) === 'true'; } catch { /* Optional visual preference. */ }

  const rotate = (point, yaw, pitch) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
    const x = point[0] * cy + point[2] * sy, z = -point[0] * sy + point[2] * cy;
    return [x, point[1] * cx - z * sx, point[1] * sx + z * cx];
  };

  function planet(canvas, context) {
    let width = 0, height = 0, sphere = [], rings = [], stars = [];
    let tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;
    const pointerHost = canvas.parentElement ?? canvas;
    const onPointer = event => {
      if (reduced.matches || userPaused || !finePointer.matches) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
    };
    const resetPointer = () => { targetX = targetY = 0; };
    pointerHost.addEventListener('pointermove', onPointer, { passive: true });
    pointerHost.addEventListener('pointerleave', resetPointer, { passive: true });

    return {
      resize(w, h) {
        width = w; height = h;
        const small = width < 520;
        const count = small ? 700 : 1300;
        const golden = Math.PI * (3 - Math.sqrt(5));
        sphere = Array.from({ length: count }, (_, index) => {
          const y = 1 - index / (count - 1) * 2;
          const radius = Math.sqrt(1 - y * y), angle = golden * index;
          return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
        });
        const ring = (radius, number, tilt, yaw, speed, spread) => ({ radius, tilt, yaw, speed,
          points: Array.from({ length: number }, (_, index) => ({
            angle: index / number * Math.PI * 2 + Math.random() * 0.02,
            offset: (Math.random() - 0.5) * spread, shade: Math.random(),
          })),
        });
        rings = [
          ring(1.55, small ? 220 : 380, 1.18, -0.42, 0.16, 0.06),
          ring(1.95, small ? 160 : 280, 1.32, 0.55, -0.1, 0.03),
          ring(2.35, small ? 70 : 120, 1.05, 0.15, 0.06, 0.12),
        ];
        stars = Array.from({ length: small ? 50 : 110 }, () => ({
          x: Math.random(), y: Math.random(), radius: Math.random() * 1.1 + 0.2, phase: Math.random() * Math.PI * 2,
        }));
      },
      draw(elapsed, still) {
        const time = still ? 9 : 9 + elapsed / 1000;
        const cx = width / 2, cy = height / 2, radius = Math.min(width * 0.195, height * 0.285);
        context.clearRect(0, 0, width, height);
        if (still) tiltX = tiltY = targetX = targetY = 0;
        tiltX += (targetX - tiltX) * 0.08; tiltY += (targetY - tiltY) * 0.08;
        const yaw = time * 0.16 + tiltX * 0.5, pitch = -0.32 + tiltY * 0.3;
        for (const star of stars) {
          const alpha = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(time * 1.3 + star.phase));
          context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          context.fillRect(star.x * width, star.y * height, star.radius, star.radius);
        }

        const front = [], back = [];
        const ringPoint = (ring, angle, offset = 0) => {
          let point = [Math.cos(angle) * (ring.radius + offset), 0, Math.sin(angle) * (ring.radius + offset)];
          point = rotate(point, ring.yaw, 0);
          point = rotate(point, 0, ring.tilt - Math.PI / 2 + pitch * 0.4);
          return rotate(point, tiltX * 0.25, 0);
        };
        rings.forEach((ring, index) => {
          for (const point of ring.points) {
            const projected = ringPoint(ring, point.angle + time * ring.speed, point.offset);
            const item = { x: cx + projected[0] * radius, y: cy + projected[1] * radius,
              index, shade: point.shade };
            (projected[2] < 0 ? back : front).push(item);
          }
        });
        const dot = (item, alpha, size) => {
          context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          context.fillRect(item.x - size / 2, item.y - size / 2, size, size);
        };
        for (const item of back) if (Math.hypot(item.x - cx, item.y - cy) >= radius * 1.02) {
          dot(item, 0.12 + 0.18 * item.shade, item.index === 2 ? 1.2 : 1.1);
        }

        const halo = context.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.9);
        halo.addColorStop(0, 'rgba(255,255,255,.10)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = halo; context.beginPath(); context.arc(cx, cy, radius * 1.9, 0, Math.PI * 2); context.fill();
        const disc = context.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius);
        disc.addColorStop(0, '#151515'); disc.addColorStop(1, '#030303');
        context.fillStyle = disc; context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.fill();

        const scan = Math.sin(time * 0.7) * 0.9;
        for (const point of sphere) {
          const projected = rotate(point, yaw, pitch);
          if (projected[2] < -0.15) continue;
          const light = Math.pow(Math.max(0, -projected[0] * 0.5 - projected[1] * 0.5 + projected[2] * 0.71), 1.6);
          const band = Math.max(0, 1 - Math.abs(projected[1] - scan) / 0.08);
          const depth = (projected[2] + 1) / 2;
          let alpha = 0.05 + light * 1.05 + band * 0.7 * depth;
          if (projected[2] < 0) alpha *= 0.25;
          const size = 0.7 + depth * 0.9 + light * 1.2 + band * 0.9;
          context.fillStyle = `rgba(255,255,255,${Math.min(1, alpha).toFixed(3)})`;
          context.fillRect(cx + projected[0] * radius - size / 2, cy + projected[1] * radius - size / 2, size, size);
        }
        context.strokeStyle = 'rgba(255,255,255,.22)'; context.lineWidth = 1;
        context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke();
        const rim = context.createRadialGradient(cx - radius * 0.45, cy - radius * 0.5, radius * 0.2,
          cx - radius * 0.2, cy - radius * 0.25, radius * 1.05);
        rim.addColorStop(0, 'rgba(255,255,255,.10)'); rim.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = rim; context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.fill();
        for (const item of front) dot(item, 0.4 + 0.55 * item.shade, item.index === 2 ? 1.8 : 1.5);

        for (const [index, phase, satelliteRadius] of [[0, 0, 4], [1, 2.4, 3], [2, 4.4, 2.4]]) {
          const ring = rings[index];
          for (let trail = 14; trail >= 0; trail--) {
            const angle = phase + (time - trail * 0.04) * ring.speed * 3.2;
            const projected = ringPoint(ring, angle);
            const x = cx + projected[0] * radius, y = cy + projected[1] * radius;
            if (projected[2] < 0 && Math.hypot(x - cx, y - cy) < radius) continue;
            if (trail === 0) {
              const glow = context.createRadialGradient(x, y, 0, x, y, satelliteRadius * 6);
              glow.addColorStop(0, 'rgba(255,255,255,.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
              context.fillStyle = glow; context.beginPath(); context.arc(x, y, satelliteRadius * 6, 0, Math.PI * 2); context.fill();
              context.fillStyle = '#fff'; context.beginPath(); context.arc(x, y, satelliteRadius, 0, Math.PI * 2); context.fill();
            } else {
              context.fillStyle = `rgba(255,255,255,${(0.5 * (1 - trail / 15)).toFixed(3)})`;
              context.beginPath(); context.arc(x, y, satelliteRadius * (1 - trail / 18), 0, Math.PI * 2); context.fill();
            }
          }
        }
      },
      resetPointer,
      destroy() {
        pointerHost.removeEventListener('pointermove', onPointer);
        pointerHost.removeEventListener('pointerleave', resetPointer);
      },
    };
  }

  function signature(canvas, context) {
    const host = canvas.closest('[data-brand-signature]') ?? canvas.parentElement ?? canvas;
    let width = 0, height = 0, points = [], seeds = [], push = [], cloud = [];
    let pointerX = -9999, pointerY = -9999, mobile = false;
    const resetPointer = () => { pointerX = pointerY = -9999; };
    const onPointer = event => {
      if (reduced.matches || userPaused || !finePointer.matches) return;
      const box = canvas.getBoundingClientRect();
      pointerX = event.clientX - box.left; pointerY = event.clientY - box.top;
    };
    host.addEventListener('pointermove', onPointer, { passive: true });
    host.addEventListener('pointerleave', resetPointer, { passive: true });

    return {
      resize(w, h) {
        width = w; height = h; mobile = width < 600;
        host.removeAttribute('data-brand-ready');
        const textElement = host.querySelector('.brand-signature-text') ?? host;
        const style = getComputedStyle(textElement);
        const sample = document.createElement('canvas');
        sample.width = Math.max(1, Math.ceil(width)); sample.height = Math.max(1, Math.ceil(height));
        const ink = sample.getContext('2d', { willReadFrequently: true });
        if (!ink) { points = []; return; }
        let fontSize = Math.min(parseFloat(style.fontSize) || height * 0.7, height * 0.78);
        ink.font = `500 ${fontSize}px ${style.fontFamily}`;
        const text = canvas.dataset.text || 'mPaiva_';
        const measured = ink.measureText(text).width;
        if (measured > width * 0.91) fontSize *= width * 0.91 / measured;
        ink.font = `500 ${fontSize}px ${style.fontFamily}`;
        if ('letterSpacing' in ink) ink.letterSpacing = style.letterSpacing;
        ink.textAlign = 'center'; ink.textBaseline = 'middle'; ink.fillStyle = '#fff';
        ink.fillText(text, width / 2, height / 2);
        const pixels = ink.getImageData(0, 0, sample.width, sample.height).data;
        const step = Math.max(2, Math.round(fontSize / 70));
        const sampled = [];
        for (let y = 0; y < sample.height; y += step) for (let x = 0; x < sample.width; x += step) {
          if (pixels[(y * sample.width + x) * 4 + 3] > 140) {
            sampled.push([x + (Math.random() - 0.5) * step, y + (Math.random() - 0.5) * step]);
          }
        }
        for (let index = sampled.length - 1; index > 0; index--) {
          const other = Math.floor(Math.random() * (index + 1));
          [sampled[index], sampled[other]] = [sampled[other], sampled[index]];
        }
        const count = sampled.length ? Math.min(sampled.length, mobile ? 1400 : 3200) : 0;
        points = Array.from({ length: count }, (_, index) => sampled[index]);
        seeds = points.map(() => [Math.random(), Math.random(), Math.random()]);
        push = points.map(() => [0, 0]);
        cloud = seeds.map(seed => {
          const angle = seed[0] * Math.PI * 2, spread = Math.sqrt(seed[1]) * Math.min(width * 0.32, height * 0.47);
          return [width / 2 + Math.cos(angle) * spread, height / 2 + Math.sin(angle) * spread];
        });
      },
      draw(elapsed, still) {
        context.clearRect(0, 0, width, height);
        if (!points.length) return;
        const time = elapsed / 1000;
        const shineX = ((time * 0.28) % 1.6 - 0.3) * width;
        for (let index = 0; index < points.length; index++) {
          const seed = seeds[index], target = points[index];
          const delay = seed[0] * 0.35;
          let progress = still ? 1 : Math.min(1, Math.max(0, (elapsed / 2400 - delay) / 0.65));
          progress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          const dx = target[0] - pointerX, dy = target[1] - pointerY, distance = Math.hypot(dx, dy);
          const radius = still || mobile ? 0 : 110;
          let forceX = 0, forceY = 0;
          if (distance < radius && distance > 0.01) {
            const force = Math.pow(1 - distance / radius, 2) * 70;
            forceX = dx / distance * force; forceY = dy / distance * force;
          }
          const displacement = push[index];
          displacement[0] += (forceX - displacement[0]) * 0.14;
          displacement[1] += (forceY - displacement[1]) * 0.14;
          if (still) displacement[0] = displacement[1] = 0;
          const x = cloud[index][0] + (target[0] - cloud[index][0]) * progress + displacement[0] + (still ? 0 : Math.sin(time * 1.3 + index) * 0.6);
          const y = cloud[index][1] + (target[1] - cloud[index][1]) * progress + displacement[1] + (still ? 0 : Math.cos(time * 1.1 + index * 0.7) * 0.6);
          const band = still ? 0 : Math.exp(-Math.pow((x - shineX) / (width * 0.07), 2));
          const alpha = Math.min(1, 0.95 * (0.62 + seed[1] * 0.38) + band * 0.5);
          const size = (mobile ? 1.3 : 1.7) + band * 1.2;
          context.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          context.fillRect(x - size / 2, y - size / 2, size, size);
        }
        host.dataset.brandReady = 'true';
      },
      resetPointer,
      destroy() {
        host.removeEventListener('pointermove', onPointer);
        host.removeEventListener('pointerleave', resetPointer);
      },
    };
  }

  function createStage(canvas, factory) {
    const context = canvas.getContext?.('2d');
    if (!context) { canvas.dataset.brandMotion = 'unavailable'; return; }
    const renderer = factory(canvas, context);
    let width = 0, height = 0, dpr = 1, raf = 0, elapsed = 0, previous = 0;
    let visible = false, destroyed = false;
    const isStill = () => reduced.matches || userPaused;
    const canRun = () => !destroyed && visible && !document.hidden && !pageSuspended && !isStill() && width > 0 && height > 0;
    const setStatus = value => { if (canvas.dataset.brandMotion !== value) canvas.dataset.brandMotion = value; };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = previous = 0; };
    const frame = now => {
      raf = 0;
      if (!canvas.isConnected) { destroy(); return; }
      if (!canRun()) { refresh(); return; }
      if (!previous || now - previous >= 1000 / 30) {
        elapsed += previous ? Math.min(now - previous, 100) : 0;
        previous = now;
        renderer.draw(elapsed, false);
      }
      raf = requestAnimationFrame(frame);
    };
    const refresh = () => {
      stop();
      if (destroyed || !width || !height) return;
      renderer.resetPointer();
      if (isStill()) {
        renderer.draw(elapsed, true);
        setStatus('static');
      } else if (canRun()) {
        setStatus('running');
        raf = requestAnimationFrame(frame);
      } else setStatus('paused');
    };
    const resize = (force = false) => {
      if (destroyed) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) { width = height = 0; stop(); setStatus('paused'); return; }
      const density = Math.min(devicePixelRatio || 1, 2);
      if (!force && width === box.width && height === box.height && dpr === density) return;
      width = box.width; height = box.height; dpr = density;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.resize(width, height);
      renderer.draw(elapsed, isStill());
      canvas.dataset.brandRendered = 'true';
      refresh();
    };
    const intersection = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === canvas);
      if (entry) { visible = entry.isIntersecting; refresh(); }
    }) : null;
    const sizeObserver = 'ResizeObserver' in window ? new ResizeObserver(() => resize()) : null;
    function destroy() {
      if (destroyed) return;
      stop(); destroyed = true;
      intersection?.disconnect(); sizeObserver?.disconnect();
      window.removeEventListener('resize', onResize);
      renderer.destroy();
    }
    const onResize = () => resize();
    if (!intersection) {
      const box = canvas.getBoundingClientRect();
      visible = box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
    }
    intersection?.observe(canvas); sizeObserver?.observe(canvas);
    window.addEventListener('resize', onResize, { passive: true });
    resize();
    stages.push({ refresh, resize, destroy });
  }

  function updatePreference() {
    document.documentElement.dataset.brandPaused = String(userPaused || reduced.matches || document.hidden || pageSuspended);
    for (const button of document.querySelectorAll('[data-brand-toggle]')) {
      button.disabled = reduced.matches;
      button.setAttribute('aria-pressed', String(userPaused || reduced.matches));
      button.textContent = reduced.matches ? 'Movimento reduzido' : userPaused ? 'Ativar animações' : 'Pausar animações';
    }
    if (reduced.matches || userPaused) for (const animation of wordmarkAnimations) animation.cancel();
    for (const stage of stages) stage.refresh();
  }

  function initialize() {
    for (const canvas of document.querySelectorAll('canvas[data-brand-planet]')) createStage(canvas, planet);
    for (const canvas of document.querySelectorAll('canvas[data-brand-name]')) createStage(canvas, signature);
    for (const button of document.querySelectorAll('[data-brand-toggle]')) button.addEventListener('click', () => {
      userPaused = !userPaused;
      try { localStorage.setItem(preferenceKey, String(userPaused)); } catch { /* Motion remains usable without persistence. */ }
      updatePreference();
    });
    updatePreference();
    if (!reduced.matches && !userPaused) for (const mark of document.querySelectorAll('[data-brand-wordmark]')) {
      if (mark.closest('[data-brand-signature]') || typeof mark.animate !== 'function') continue;
      wordmarkAnimations.push(mark.animate([{ opacity: 0.72, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
    }
    document.fonts?.ready.then(() => { for (const stage of stages) stage.resize(true); });
  }

  reduced.addEventListener('change', updatePreference);
  document.addEventListener('visibilitychange', updatePreference);
  window.addEventListener('pagehide', () => { pageSuspended = true; updatePreference(); });
  window.addEventListener('pageshow', () => { pageSuspended = false; updatePreference(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
