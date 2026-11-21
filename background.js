(() => {
  const scene = {
    leaf: {
      size: 390, // Blade length in CSS pixels at desktop widths.
      position: { x: 0.86, y: 0.39 },
      angle: -0.91,
      cellSize: 9,
      colors: {
        shade: '#537d72',
        teal: '#76aa96',
        sage: '#9db395',
        edge: '#aabb9d',
        vein: '#eee2bf',
        amber: '#d1af7e',
      },
      veinGlow: { color: '#dec193', radius: 6.5 }, // Halo radius in CSS pixels.
    },
    wind: { color: '#7da3a3', opacity: 0.34 },
    population: {
      targetLeafCount: 5,
      spawnIntervalRange: [7, 12], // Seconds between entries on desktop.
      minLeafScale: 0.62,
      maxLeafScale: 0.96,
      minTravelSpeed: 19, // CSS pixels per second on desktop.
      maxTravelSpeed: 29,
      windStrength: 1,
      turbulenceStrength: 1,
      rotationStrength: 0.42, // Radians of gentle tumble around each leaf's initial angle.
      glowIntensity: 1, // Multiplier for halo brightness. The vein core stays crisp.
    },
    eddy: {
      frequency: 18, // Average seconds between eddies. Zero disables them.
      radius: 224, // Typical radius in CSS pixels at desktop sizes.
      strength: 31, // Typical peak tangential speed in CSS pixels per second.
    },
    illumination: {
      frequency: 44, // Average seconds between events per leaf. Zero disables them.
      peakBrightness: 0.72, // Extra halo and bright vein opacity at the peak.
      duration: 5.5, // Typical event length in seconds.
    },
    maxPixelRatio: 2,
    maxCanvasPixels: 4_500_000,
  };

  const canvas = document.querySelector('.background-layer canvas');
  const context = canvas?.getContext('2d');
  const column = document.querySelector('main.reading-column');
  if (!context || !column) return;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  // Each curve ends with its bend, dash speed multiplier, and opacity multiplier.
  const streaks = [
    [0.03, 0.25, 0.15, 0.15, 0.27, 0.30, 0.40, 0.20, 5, 1, 1],
    [0.62, 0.66, 0.75, 0.54, 0.88, 0.75, 0.98, 0.62, -4, 1.13, 1],
    [0.10, 0.83, 0.21, 0.72, 0.34, 0.87, 0.47, 0.77, 5, 1.26, 1],
    [0.66, 0.19, 0.75, 0.25, 0.86, 0.11, 0.97, 0.16, 3, 0.88, 0.74],
    [0.01, 0.50, 0.06, 0.46, 0.15, 0.54, 0.23, 0.48, -3, 1.17, 0.60],
    [0.73, 0.88, 0.82, 0.79, 0.90, 0.91, 1.02, 0.82, 4, 0.77, 0.68],
  ];
  const windDashes = [11, 9, 3, 12];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const control = document.getElementById('animation-control');
  let paused = false;
  const config = scene.population;
  const still = { wind: 0, flow: 0 };
  const breeze = { ...still, distance: 0 };
  const leaves = [];
  const traceSteps = 24;
  const eddies = [0, 1].map(() => ({ end: 0, amount: 0, trace: new Float32Array(4 * traceSteps + 2) }));
  const localWind = { x: 0, y: 0, turn: 0 };
  const eddyDashes = [17, 7, 4, 11];
  let nextEddy = scene.eddy.frequency * 0.35;
  let eddyIndex = 0;
  const { shade, teal, sage } = scene.leaf.colors;
  const bodyPalettes = [
    [shade, teal, sage],
    ['#547e75', '#71a89b', '#96b4a1'],
    ['#5a7e6c', '#85ac92', '#a7b899'],
  ];
  const randomBetween = (min, max) => min + Math.random() * (max - min);
  let layout;
  let frameId = null;
  let lastTime;
  let elapsed = 0;
  let nextSpawn = 0;

  function windAt(t) {
    return config.windStrength * (0.71 * Math.sin(t * 0.19) + 0.29 * Math.sin(t * 0.071));
  }

  function gustDistanceAt(t) {
    // Integral of the gusts that also bend the wind streaks.
    return config.windStrength * (0.71 * (1 - Math.cos(t * 0.19)) / 0.19
      + 0.29 * (1 - Math.cos(t * 0.071)) / 0.071);
  }

  function breezeAt(t) {
    breeze.wind = windAt(t);
    breeze.flow = config.windStrength * (7 * t + 9 * (1 - Math.cos(t * 0.19)));
    breeze.distance = gustDistanceAt(t);
    return breeze;
  }

  // Fixed variation for each cell, so redrawing does not change the pattern.
  function grain(columnIndex, rowIndex) {
    const value = Math.sin(columnIndex * 127.1 + rowIndex * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function updateEddies(time) {
    const { frequency, radius, strength } = scene.eddy;
    if (frequency <= 0 || radius <= 0 || strength <= 0) return;
    if (time >= nextEddy) {
      const eddy = eddies.find(item => item.end <= time);
      const seed = leaves[0]?.seed ?? 3;
      const index = ++eddyIndex * 7;
      nextEddy = time + frequency * (0.68 + 0.64 * grain(index, seed));
      if (eddy) {
        eddy.start = time;
        eddy.end = time + 15 + 9 * grain(index + 1, seed);
        eddy.x = 0.23 + 0.55 * grain(index + 2, seed);
        eddy.y = 0.21 + 0.58 * grain(index + 3, seed);
        eddy.radius = radius * (0.74 + 0.52 * grain(index + 4, seed));
        eddy.strength = strength * (0.64 + 0.54 * grain(index + 5, seed))
          * (grain(index + 6, seed) < 0.5 ? -1 : 1);
        if (eddyIndex % 3 !== 0) guideEddyCenter(eddy);
      }
    }
    for (const eddy of eddies) {
      eddy.amount = eddy.end > time ? Math.sin(Math.PI * (time - eddy.start) / (eddy.end - eddy.start)) ** 2 : 0;
      eddy.screenX = eddy.x * layout.width;
      eddy.screenY = eddy.y * layout.height;
      eddy.screenRadius = eddy.radius * layout.eddyScale;
    }
  }

  // Favor air that a leaf will reach while the current is strongest. Once
  // placed, the current stays put and influences anything that passes through.
  function guideEddyCenter(eddy) {
    const { width, height, eddyScale } = layout;
    const peak = (eddy.start + eddy.end) * 0.5;
    const distance = gustDistanceAt(peak);
    const wind = windAt(peak);
    let nearest = Infinity;
    let goalX = eddy.x;
    let goalY = eddy.y;
    for (const leaf of leaves) {
      if (!leaf.active) continue;
      const age = peak - leaf.born;
      const x = travelX(leaf, age, distance);
      const y = driftY(leaf, age * 0.069 + x * 0.002, wind);
      if (x < width * 0.18 || x > width * 0.8 || y < height * 0.14 || y > height * 0.86) continue;
      const radius = eddy.radius * eddyScale;
      const cx = (x + radius * 0.24) / width;
      const cy = (y + Math.sign(eddy.strength) * radius * 0.29) / height;
      const score = ((cx - eddy.x) * width) ** 2 + ((cy - eddy.y) * height) ** 2;
      if (score >= nearest) continue;
      nearest = score;
      goalX = cx;
      goalY = cy;
    }
    eddy.x = clamp(0.2 * eddy.x + 0.8 * goalX, 0.23, 0.82);
    eddy.y = clamp(0.2 * eddy.y + 0.8 * goalY, 0.2, 0.80);
  }

  function localWindAt(x, y) {
    localWind.x = localWind.y = localWind.turn = 0;
    for (const eddy of eddies) {
      if (!eddy.amount) continue;
      const radius = eddy.screenRadius;
      const dx = (x - eddy.screenX) / radius;
      const dy = (y - eddy.screenY) / radius;
      const inside = 1 - dx * dx - dy * dy;
      if (inside <= 0) continue;
      // A tangential field that eases to zero at its edge and in its lifetime.
      const spin = 3 * eddy.strength * layout.eddyScale * eddy.amount * inside * inside;
      localWind.x -= dy * spin;
      localWind.y += dx * spin;
      localWind.turn += spin / radius;
    }
    return localWind;
  }

  // Trace a short open streamline through the same current the leaves sample.
  // Stop before the arc can close into a loop.
  function traceEddy(eddy, direction, carrier) {
    const { trace, screenX, screenY, screenRadius } = eddy;
    let x = trace[traceSteps * 2];
    let y = trace[traceSteps * 2 + 1];
    let index = traceSteps;
    let lastAngle;
    let turn = 0;
    const step = screenRadius * 0.037 * direction;
    const turnLimit = direction === 1 ? 2.40 : 0.88;
    for (let segment = 0; segment < traceSteps; segment++) {
      const start = localWindAt(x, y);
      const speed = Math.hypot(carrier + start.x, start.y);
      if (speed < 1) break;
      const middle = localWindAt(x + (carrier + start.x) * step / (2 * speed),
        y + start.y * step / (2 * speed));
      if (Math.hypot(carrier + middle.x, middle.y) < 1) break;
      const angle = Math.atan2(middle.y, carrier + middle.x);
      if (lastAngle !== undefined) {
        const change = angle - lastAngle;
        turn += Math.abs(Math.atan2(Math.sin(change), Math.cos(change)));
      }
      if (turn > turnLimit) break;
      lastAngle = angle;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      if (Math.hypot(x - screenX, y - screenY) > screenRadius * 0.88) break;
      index += direction;
      trace[index * 2] = x;
      trace[index * 2 + 1] = y;
    }
    return index;
  }

  function drawEddyCurrents(breeze) {
    context.setLineDash(eddyDashes);
    for (const eddy of eddies) {
      if (eddy.amount < 0.04) continue;
      const { trace, screenX, screenY, screenRadius } = eddy;
      // Start on the fast-moving shoulder, away from the stagnation point.
      trace[traceSteps * 2] = screenX + screenRadius * 0.10;
      trace[traceSteps * 2 + 1] = screenY - Math.sign(eddy.strength) * screenRadius * 0.39;
      const carrier = (8 + 1.4 * breeze.wind) * layout.eddyScale;
      const start = traceEddy(eddy, -1, carrier);
      const end = traceEddy(eddy, 1, carrier);
      if (end - start < 2) continue;
      const x1 = trace[start * 2];
      const y1 = trace[start * 2 + 1];
      const edge = context.createRadialGradient(screenX, screenY, 0, screenX, screenY, screenRadius);
      edge.addColorStop(0, scene.wind.color);
      edge.addColorStop(0.64, scene.wind.color);
      edge.addColorStop(1, 'transparent');
      context.strokeStyle = edge;
      context.lineWidth = layout.width < 700 ? 1.15 : 1.5;
      const overCopy = screenX > layout.readingLeft && screenX < layout.readingRight;
      context.globalAlpha = scene.wind.opacity * eddy.amount * (overCopy ? 1.22 : 1.65);
      context.lineDashOffset = -breeze.flow % 39;
      context.beginPath();
      context.moveTo(x1, y1);
      for (let index = start + 1; index <= end; index++) {
        context.lineTo(trace[index * 2], trace[index * 2 + 1]);
      }
      context.stroke();
    }
  }

  const spriteAllocationFailure = new Error('Canvas sprite allocation failed');

  function createSpriteContext(width, height) {
    let ctx;
    try {
      const sprite = document.createElement('canvas');
      sprite.width = width;
      sprite.height = height;
      ctx = sprite.getContext('2d');
    } catch {
      throw spriteAllocationFailure;
    }
    if (!ctx) throw spriteAllocationFailure;
    return ctx;
  }

  function makeBackdrop(width, height, pixelRatio) {
    const scale = Math.min(pixelRatio, 1.5);
    const ctx = createSpriteContext(Math.ceil(width * scale), Math.ceil(height * scale));
    ctx.setTransform(ctx.canvas.width / width, 0, 0, ctx.canvas.height / height, 0, 0);
    return ctx;
  }

  function vegetationFade(x, bounds) {
    const outside = Math.max(bounds.left - x, x - bounds.right);
    return 0.26 + 0.74 * clamp((outside + 8) / 28, 0, 1);
  }

  function buildFoliageBranch(x, side, width, depth, leafScale, pixelRatio, bounds, branch, font, compact) {
    const palettes = [
      { shade: '#233f30', teal: '#375641', sage: '#465f42', edge: '#3d5743', vein: '#526746', amber: '#5f7250' },
      { shade: '#3d512f', teal: '#536a37', sage: '#637744', edge: '#56693c', vein: '#839356', amber: '#839153' },
      { shade: '#5f6930', teal: '#858f43', sage: '#929a4a', edge: '#818944', vein: '#b8b16a', amber: '#a9a656' },
    ];
    const { controls, leaves: leavesOnBranch, seed } = branch;
    const pad = Math.ceil(width * 0.18);
    const spriteWidth = Math.ceil(width * 1.4 + 2 * pad);
    const rootX = side === 1 ? pad : spriteWidth - pad;
    const ctx = makeBackdrop(spriteWidth, depth, pixelRatio);
    ctx.translate(rootX, depth);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    function stemX(t) {
      const u = 1 - t;
      return side * width * (3 * u * u * t * controls[0] + 3 * u * t * t * controls[2] + t ** 3 * controls[4]);
    }

    function stemY(t) {
      const u = 1 - t;
      return -depth * (3 * u * u * t * controls[1] + 3 * u * t * t * controls[3] + t ** 3 * controls[5]);
    }

    ctx.font = `600 ${compact ? 8.5 : 11}px ${font}`;
    const steps = Math.ceil(depth * controls[5] / (compact ? 4.6 : 5.7));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const dx = stemX(t);
      const py = stemY(t);
      const slope = stemX(Math.min(t + 0.016, 1)) - stemX(Math.max(t - 0.016, 0));
      ctx.globalAlpha = 0.65 * vegetationFade(x + dx, bounds);
      ctx.fillStyle = palettes[branch.tone].vein;
      ctx.fillText(Math.abs(slope) < 1.6 ? '|' : slope > 0 ? '/' : '\\', dx, py);
    }

    // Individual leaves share the airborne leaf brush. They stay attached to
    // the branches, with broader blades, denser glyphs, and no floating halo.
    for (const [t, ratio, pitch, tone, broad] of leavesOnBranch) {
      const span = leafScale * ratio;
      const angle = Math.atan2(-Math.sin(pitch), side * Math.cos(pitch));
      const cx = stemX(t) + Math.cos(angle) * span * 0.60;
      const cy = stemY(t) + Math.sin(angle) * span * 0.60;
      const cell = clamp(span / 23, compact ? 3.6 : 4.6, compact ? 5.1 : 7.1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.font = `600 ${cell * 1.40}px ${font}`;
      paintAsciiLeaf(ctx, span, cell, angle, palettes[tone], {
        fullness: broad * (compact ? 1.5 : 1.65), curvature: 1.42,
        filled: true, seed: seed + Math.round(t * 71),
        veinGlyph: Math.abs(Math.cos(angle)) > 0.94 ? '-' : side * Math.cos(pitch) > 0 ? '/' : '\\',
        fade: cellX => vegetationFade(x + cx + cellX, bounds),
      });
      ctx.restore();
    }

    return { sprite: ctx.canvas, x, rootX, width: spriteWidth, depth, seed, rise: depth * controls[5] };
  }

  function buildUndergrowth(width, height, bounds, pixelRatio) {
    const compact = width < 700;
    const font = getComputedStyle(document.documentElement).fontFamily;
    const depth = height * (compact ? 0.48 : 0.86);
    const leafScale = height * (compact ? 0.345 : 0.48);
    const reach = Math.min(width * (compact ? 0.30 : 0.29), height * 0.53);
    // Each branch has its own root, curve, and staggered leaves. Rear branches
    // are painted behind the larger olive leaves near each corner.
    const edges = [
      { side: 1, branches: [
        { inset: 0.065, seed: 17, tone: 0, controls: [0.12, 0.31, 0.06, 0.68, 0.34, 0.90], leaves: [
          [0.20, 0.24, 1.95, 0, 1.32], [0.34, 0.25, 0.44, 0, 1.32], [0.50, 0.24, 1.53, 0, 1.33],
          [0.67, 0.24, 0.40, 1, 1.36], [0.79, 0.18, 1.86, 0, 1.27], [0.91, 0.19, 1.03, 1, 1.27],
        ] },
        { inset: 0.042, seed: 33, tone: 0, controls: [0.28, 0.12, 0.22, 0.30, 0.70, 0.41], leaves: [
          [0.30, 0.27, 1.18, 1, 1.32], [0.50, 0.30, 0.28, 0, 1.42], [0.65, 0.26, 1.03, 0, 1.37],
          [0.84, 0.22, 0.08, 0, 1.32],
        ] },
        { inset: 0.055, seed: 49, tone: 2, controls: [0.09, 0.26, 0.12, 0.47, 0.50, 0.60], leaves: [
          [0.23, 0.27, 1.72, 1, 1.38], [0.36, 0.27, 0.49, 1, 1.44], [0.49, 0.23, 1.16, 1, 1.39],
          [0.68, 0.42, 0.64, 2, 1.43], [0.91, 0.22, 0.20, 1, 1.34],
        ] },
        { inset: 0.038, seed: 61, tone: 1, controls: [0.27, 0.035, 0.40, 0.14, 0.67, 0.21], leaves: [
          [0.40, 0.34, 0.45, 2, 1.43], [0.65, 0.29, 0.94, 1, 1.44], [0.78, 0.22, 0.24, 1, 1.33],
        ] },
      ] },
      { side: -1, branches: [
        { inset: 0.060, seed: 73, tone: 0, controls: [0.08, 0.31, 0.12, 0.72, 0.30, 0.86], leaves: [
          [0.19, 0.24, 1.90, 0, 1.32], [0.36, 0.26, 0.38, 0, 1.40], [0.52, 0.22, 1.61, 1, 1.34],
          [0.69, 0.25, 0.43, 0, 1.39], [0.86, 0.21, 0.86, 1, 1.29], [0.94, 0.15, 0.52, 0, 1.25],
        ] },
        { inset: 0.035, seed: 87, tone: 1, controls: [0.08, 0.20, 0.13, 0.40, 0.54, 0.58], leaves: [
          [0.45, 0.34, 0.87, 1, 1.44], [0.62, 0.24, 1.22, 0, 1.32], [0.79, 0.26, 0.31, 1, 1.43],
        ] },
        { inset: 0.052, seed: 102, tone: 2, controls: [0.05, 0.18, 0.28, 0.34, 0.65, 0.47], leaves: [
          [0.27, 0.29, 1.78, 1, 1.35], [0.43, 0.34, 0.97, 2, 1.35], [0.57, 0.24, 1.26, 0, 1.36], [0.71, 0.42, 0.41, 2, 1.47],
          [0.88, 0.22, 0.20, 1, 1.34],
        ] },
        { inset: 0.035, seed: 119, tone: 1, controls: [0.24, 0.04, 0.46, 0.16, 0.76, 0.22], leaves: [
          [0.32, 0.27, 0.63, 1, 1.40], [0.56, 0.35, 0.49, 2, 1.40], [0.77, 0.23, 0.12, 0, 1.33],
        ] },
      ] },
    ];
    const plants = [];
    for (const { side, branches } of edges) {
      for (let index = 0; index < branches.length; index++) {
        if (compact && index === 1) continue;
        const branch = branches[index];
        const inset = branch.inset * reach;
        const x = side === 1 ? -inset : width + inset;
        plants.push(buildFoliageBranch(x, side, reach, depth, leafScale, pixelRatio, bounds, branch, font, compact));
      }
    }
    return plants;
  }

  function drawUndergrowth(time, field, stillFrame) {
    const { height, undergrowth } = layout;
    // The rear tiers paint last because this pass uses destination-over.
    for (let index = undergrowth.length - 1; index >= 0; index--) {
      const plant = undergrowth[index];
      const local = stillFrame ? 0 : localWindAt(plant.x, height - plant.rise * 0.67).x;
      const phase = time * (0.38 + plant.seed % 7 * 0.043) + plant.seed;
      const bend = stillFrame ? 0 : plant.rise * (field.wind * 0.019
        + Math.sin(phase) * (0.007 + plant.seed % 5 * 0.0014)
        + clamp(local * 0.0009, -0.017, 0.017));
      context.save();
      context.translate(plant.x, height);
      if (stillFrame || Math.abs(bend) < 0.35) {
        context.drawImage(plant.sprite, -plant.rootX, -plant.depth, plant.width, plant.depth);
      } else {
        // A piecewise shear bends each frond progressively toward its tip.
        const rows = plant.sprite.height;
        const bands = plant.rise > 130 ? 4 : 2;
        for (let band = 0; band < bands; band++) {
          const first = Math.round(rows * band / bands);
          const last = Math.round(rows * (band + 1) / bands);
          const top = -plant.depth * (1 - first / rows);
          const bottom = -plant.depth * (1 - last / rows);
          const shiftTop = bend * (top / plant.depth) ** 2;
          const shiftBottom = bend * (bottom / plant.depth) ** 2;
          const shear = (shiftBottom - shiftTop) / (bottom - top);
          context.save();
          context.transform(1, 0, shear, 1, shiftTop - shear * top, 0);
          context.drawImage(plant.sprite, 0, first, plant.sprite.width, last - first,
            -plant.rootX, top, plant.width, bottom - top);
          context.restore();
        }
      }
      context.restore();
    }
  }

  function drawWind(width, height, breeze) {
    context.save();
    context.strokeStyle = scene.wind.color;
    context.lineWidth = 1;
    context.lineCap = 'round';
    context.setLineDash(windDashes);
    const localCurrents = breeze !== still && eddies.some(eddy => eddy.amount > 0.02);
    const count = width < 700 ? 4 : streaks.length;
    for (let index = 0; index < count; index++) {
      const [x, y, x1, y1, x2, y2, endX, endY, flex, speed, opacity] = streaks[index];
      const bend = breeze.wind * flex;
      context.globalAlpha = clamp(scene.wind.opacity * opacity * (1 + breeze.wind * 0.12), 0, 1);
      context.lineDashOffset = index * 9 - (breeze.flow * speed) % 35;
      context.beginPath();
      context.moveTo(x * width, y * height);
      if (localCurrents) {
        // Push samples of the prevailing streak through the local wind field.
        for (let segment = 1; segment <= 24; segment++) {
          const t = segment / 24;
          const u = 1 - t;
          const px = width * (u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * endX);
          const py = height * (u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * endY)
            + 3 * u * t * bend * (u - 0.6 * t);
          const wind = localWindAt(px, py);
          const taper = Math.sin(Math.PI * t) * 1.05;
          context.lineTo(px + wind.x * taper, py + wind.y * taper);
        }
      } else {
        context.bezierCurveTo(x1 * width, y1 * height + bend, x2 * width, y2 * height - bend * 0.6,
          endX * width, endY * height);
      }
      context.stroke();
    }
    if (breeze !== still) drawEddyCurrents(breeze);
    context.restore();
  }

  // Both kinds of leaves use the same silhouette, glyph grid, and vein samples.
  function paintAsciiLeaf(glyphLayer, span, cell, angle, colors, {
    fullness = 1, curvature = 1, filled = false, seed = 0, veinGlyph = '/', fade = () => 1, onVein,
  } = {}) {
    const radius = Math.ceil(span * (fullness > 2 ? 0.81 : 0.67) / cell);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let maxX = 0;
    let maxY = 0;
    for (let row = -radius; row <= radius; row++) {
      for (let col = -radius; col <= radius; col++) {
        const x = col * cell;
        const y = row * cell;
        const along = (x * cos + y * sin) / span + 0.5;
        if (along < -0.19 || along > 1) continue;

        // A curved spine with tapered sides and small serrations along the rim.
        const bend = (0.09 * Math.sin(along * Math.PI) - 0.035 * along) * curvature;
        const lateral = (-x * sin + y * cos) / span - bend;
        const noise = grain(col, row + seed);
        const blade = Math.pow(Math.sin(Math.max(0, along) * Math.PI), 0.82)
          * (0.27 - 0.10 * along) * fullness;
        const edge = blade * (lateral < 0 ? 0.89 : 1.06)
          * (0.94 + 0.06 * Math.cos(along * Math.PI * 34));
        const stem = along < 0 && Math.abs(lateral) < cell * 0.58 / span;
        if (!stem && (along < 0 || Math.abs(lateral) > edge)) continue;

        const distance = Math.abs(lateral);
        const rim = edge - distance < cell * 0.9 / span;
        const spine = distance < cell * 0.53 / span;
        const branch = Math.abs(Math.sin((along - distance * 1.25) * Math.PI * 9)) < 0.32;
        const highlight = !spine && (branch || rim) && noise > 0.91;
        let glyph;
        let color;
        if (stem || spine) {
          glyph = veinGlyph;
          color = colors.vein;
        } else if (rim) {
          glyph = noise < 0.38 ? '.' : ':';
          color = colors.edge;
        } else if (branch) {
          glyph = lateral < 0 ? '-' : '|';
          color = colors.sage;
        } else {
          const texture = filled ? '+x|%;' : noise < 0.38 ? '.::' : '+*x%';
          glyph = texture[Math.floor(noise * 19) % texture.length];
          color = lateral < 0 ? colors.shade : colors.teal;
        }

        maxX = Math.max(maxX, Math.abs(x));
        maxY = Math.max(maxY, Math.abs(y));
        const opacity = spine ? 0.96 : 0.71 + noise * 0.24;
        const tint = highlight ? colors.amber : color;
        glyphLayer.globalAlpha = opacity * fade(x);
        glyphLayer.fillStyle = tint;
        glyphLayer.fillText(glyph, x, y);
        if (spine && !stem && onVein) onVein(glyph, x, y, opacity);
      }
    }
    return { maxX, maxY };
  }

  // Bake a few palettes from the same glyph grid and share them across the pool.
  function buildLeaf(span, pixelRatio, palette, shared) {
    const { size, angle, cellSize, veinGlow } = scene.leaf;
    const colors = { ...scene.leaf.colors, shade: palette[0], teal: palette[1], sage: palette[2] };
    const cell = clamp(cellSize * span / size, 5.5, cellSize);
    const font = getComputedStyle(document.documentElement).fontFamily;

    const radius = Math.ceil(span * 0.67 / cell);
    const halfSize = Math.ceil(radius * cell + cell * 2 + veinGlow.radius * 3);
    function makeLayer() {
      const pixels = Math.ceil(2 * halfSize * pixelRatio);
      const ctx = createSpriteContext(pixels, pixels);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, halfSize * pixelRatio, halfSize * pixelRatio);
      ctx.font = `600 ${cell * 1.35}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      return ctx;
    }
    const glyphLayer = makeLayer();
    const haloLayer = shared ? null : makeLayer();
    const litVein = shared ? null : makeLayer();
    if (litVein) litVein.fillStyle = '#fff4d7';
    // Offset the shadow so only the halo enters its transparent sprite.
    const haloOffset = 2 * halfSize + cell;
    if (haloLayer) haloLayer.shadowOffsetX = haloOffset * pixelRatio;
    const onVein = litVein ? (glyph, x, y, opacity) => {
      litVein.fillText(glyph, x, y);
      if (veinGlow.radius <= 0) return;
      haloLayer.globalAlpha = opacity * 0.86;
      haloLayer.shadowColor = veinGlow.color;
      haloLayer.shadowBlur = veinGlow.radius * pixelRatio;
      haloLayer.fillText(glyph, x - haloOffset, y);
    } : undefined;
    const { maxX, maxY } = paintAsciiLeaf(glyphLayer, span, cell, angle, colors, { onVein });
    return {
      glyphs: glyphLayer.canvas, halo: shared?.halo ?? haloLayer.canvas,
      litVein: shared?.litVein ?? litVein.canvas, halfSize,
      size: glyphLayer.canvas.width / pixelRatio,
      // Includes each character's extent and the localized halo.
      margin: Math.hypot(maxX, maxY) + cell * 2 + veinGlow.radius * 3,
      halfWidth: maxX + cell,
      halfHeight: maxY + cell,
    };
  }

  function buildSprites(span, pixelRatio) {
    const base = buildLeaf(span, pixelRatio, bodyPalettes[0]);
    return [base, ...bodyPalettes.slice(1).map(palette => buildLeaf(span, pixelRatio, palette, base))];
  }

  // Smoothly join seeded gust samples. Both slope and acceleration are
  // continuous at the knots, and each leaf samples a different part of the field.
  function gust(time, seed) {
    const index = Math.floor(time);
    const fraction = time - index;
    const blend = fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
    const a = grain(index, seed);
    const b = grain(index + 1, seed);
    return 2 * (a + (b - a) * blend) - 1;
  }

  function gustSlope(time, seed) {
    const index = Math.floor(time);
    const fraction = time - index;
    const slope = 30 * fraction ** 2 * (1 - fraction) ** 2;
    return 2 * (grain(index + 1, seed) - grain(index, seed)) * slope;
  }

  function scheduleSpawn(time) {
    const [min, max] = config.spawnIntervalRange;
    nextSpawn = time + randomBetween(min, max) * layout.intervalScale;
  }

  function spawn(leaf, time, field, initial = false) {
    leaf.active = true;
    leaf.born = time;
    leaf.windStart = field.distance;
    leaf.seed = randomBetween(1, 4000);
    leaf.speed = randomBetween(config.minTravelSpeed, config.maxTravelSpeed);
    leaf.scale = randomBetween(config.minLeafScale, config.maxLeafScale);
    leaf.angle = randomBetween(-0.31, 0.31);
    leaf.turn = randomBetween(0.7, 1);
    leaf.turnRate = 0.075 + 0.055 * grain(3, leaf.seed);
    leaf.turnPhase = 9 * grain(4, leaf.seed);
    leaf.glow = randomBetween(0.65, 1);
    leaf.palette = Math.floor(Math.random() * bodyPalettes.length);
    leaf.eddyX = leaf.eddyY = leaf.eddyTurn = 0;
    leaf.windResponse = 0.34 + 0.9 * grain(17, leaf.seed);
    leaf.lightIndex = 0;
    leaf.lightStart = time + scene.illumination.frequency * (0.26 + 0.65 * grain(15, leaf.seed));
    leaf.lightDuration = scene.illumination.duration * (0.8 + 0.4 * grain(16, leaf.seed));
    leaf.startGust = gust(0, leaf.seed);
    chooseEntry(leaf, time, initial);
    updateLeaf(leaf, time, field);
  }

  function travelX(leaf, age, windDistance) {
    const distance = leaf.speed * (age + 0.27 * (windDistance - leaf.windStart));
    return leaf.origin + layout.speedScale * (distance
      + 11 * config.turbulenceStrength * (gust(age * 0.07, leaf.seed) - leaf.startGust));
  }

  function driftY(leaf, sample, wind) {
    const crosswind = 0.72 * gust(sample, leaf.seed + 10)
      + 0.28 * gust(sample * 0.57 + 2, leaf.seed + 20);
    return layout.height * leaf.baseline
      + layout.sway * config.turbulenceStrength * (crosswind + 0.12 * wind);
  }

  function updateLeaf(leaf, time, field, dt = 0) {
    const age = time - leaf.born;
    leaf.x = travelX(leaf, age, field.distance);
    const sample = age * 0.069 + leaf.x * 0.002;
    leaf.y = driftY(leaf, sample, field.wind);
    // Blend a slow, uneven tumble with the shared breeze and a small lean
    // in the direction that the crosswind is carrying the leaf.
    const turnSample = age * leaf.turnRate + leaf.turnPhase + leaf.x * 0.001;
    const tumble = 0.76 * gust(turnSample, leaf.seed + 30)
      + 0.24 * gust(turnSample * 0.57 + 3, leaf.seed + 40);
    const crosswindSlope = 0.72 * gustSlope(sample, leaf.seed + 10)
      + 0.28 * 0.57 * gustSlope(sample * 0.57 + 2, leaf.seed + 20);
    const heading = Math.atan2(layout.sway * config.turbulenceStrength * crosswindSlope * 0.115,
      leaf.speed * layout.speedScale);
    const lean = clamp(heading / 0.45, -1, 1);
    leaf.rotation = leaf.angle + config.rotationStrength * leaf.turn
      * (0.67 * tumble + 0.18 * field.wind + 0.15 * lean);
    if (dt > 0) {
      const current = localWindAt(leaf.x + leaf.eddyX, leaf.y + leaf.eddyY);
      // Relax toward the prevailing drift once the local current falls away.
      const settle = 1 - Math.exp(-dt / 4);
      leaf.eddyX += (4 * current.x * leaf.windResponse - leaf.eddyX) * settle;
      leaf.eddyY += (4 * current.y * leaf.windResponse - leaf.eddyY) * settle;
      leaf.eddyTurn += (clamp(current.turn * 0.9 * leaf.windResponse, -0.28, 0.28) - leaf.eddyTurn)
        * (1 - Math.exp(-dt / 1.8));
    }
    leaf.x += leaf.eddyX;
    leaf.y += leaf.eddyY;
    leaf.rotation += leaf.eddyTurn;
  }

  function illuminationAt(leaf, time) {
    const { frequency, peakBrightness, duration } = scene.illumination;
    if (frequency <= 0 || peakBrightness <= 0 || duration <= 0 || time <= leaf.lightStart) return 0;
    const progress = (time - leaf.lightStart) / leaf.lightDuration;
    if (progress < 1) return peakBrightness * Math.sin(Math.PI * progress) ** 2;
    const index = ++leaf.lightIndex * 2;
    leaf.lightStart = time + frequency * (0.62 + 0.72 * grain(index + 60, leaf.seed));
    leaf.lightDuration = duration * (0.8 + 0.4 * grain(index + 61, leaf.seed));
    return 0;
  }

  function chooseEntry(leaf, time, initial) {
    const { width, height, sprites } = layout;
    const sprite = sprites[leaf.palette];
    const leftEdge = -sprite.margin * leaf.scale - 2;
    const halfWidth = sprite.halfWidth * leaf.scale;
    const halfHeight = sprite.halfHeight * leaf.scale;
    // Compare a few points along the unmodified flight paths. Work happens
    // only on spawn, and the chosen entry never steers away from other leaves.
    const snapshots = (initial ? [0, 10, 24] : [8, 19, 32]).map(offset => {
      const wind = windAt(time + offset);
      const distance = gustDistanceAt(time + offset);
      const neighbors = [];
      for (const other of leaves) {
        if (other === leaf || !other.active) continue;
        const age = time + offset - other.born;
        const x = travelX(other, age, distance);
        const art = sprites[other.palette];
        const rx = art.halfWidth * other.scale;
        if (x + rx < 0 || x - rx > width) continue;
        neighbors.push({ x, y: driftY(other, age * 0.069 + x * 0.002, wind),
          rx, ry: art.halfHeight * other.scale });
      }
      return { offset, wind, distance, neighbors };
    });

    let best = Infinity;
    let origin;
    let baseline;
    for (let trial = 0; trial < 24; trial++) {
      leaf.origin = initial
        ? width * (layout.target === 1 ? randomBetween(0.68, 0.83) : randomBetween(0.13, 0.87))
        : leftEdge - (layout.target === 1 ? 0 : randomBetween(0, 12));
      leaf.baseline = randomBetween(0.13, 0.87);
      let crowding = Math.random() * 0.3;
      for (const { offset, wind, distance, neighbors } of snapshots) {
        const x = travelX(leaf, offset, distance);
        const y = driftY(leaf, offset * 0.069 + x * 0.002, wind);
        const verticalInset = Math.min(halfHeight * 0.55, height * 0.24);
        crowding += Math.max(0, verticalInset - y, y - height + verticalInset) / height * 3;
        for (const neighbor of neighbors) {
          const dx = (x - neighbor.x) / (halfWidth + neighbor.rx);
          const dy = (y - neighbor.y) / (halfHeight + neighbor.ry);
          crowding += 1 / (0.28 + dx * dx + dy * dy) + 0.15 / (0.5 + dy * dy);
        }
      }
      if (crowding >= best) continue;
      best = crowding;
      origin = leaf.origin;
      baseline = leaf.baseline;
    }
    leaf.origin = origin;
    leaf.baseline = baseline;
  }

  function drawLeaf(sprite, x, y, scale, rotation, glow, illumination = 0) {
    const size = sprite.size * scale;
    const offset = -sprite.halfSize * scale;
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    const haloOpacity = clamp(glow * config.glowIntensity, 0, 1);
    context.globalAlpha = haloOpacity;
    context.drawImage(sprite.halo, offset, offset, size, size);
    if (illumination > 0) {
      context.globalAlpha = clamp(illumination * haloOpacity, 0, 1);
      context.drawImage(sprite.halo, offset, offset, size, size);
    }
    context.globalAlpha = 1;
    context.drawImage(sprite.glyphs, offset, offset, size, size);
    if (illumination > 0) {
      context.globalAlpha = clamp(illumination, 0, 1);
      context.drawImage(sprite.litVein, offset, offset, size, size);
    }
    context.restore();
  }

  function drawFrame(time, field, staticFrame = false, dt = 0) {
    if (!layout) return;
    const { width, height, sprites } = layout;
    context.clearRect(0, 0, width, height);
    if (staticFrame) {
      drawLeaf(sprites[0], layout.stillX, height * scene.leaf.position.y, 1, 0, 1);
    } else {
      updateEddies(time);
      let onRoute = 0;
      for (const leaf of leaves) {
        if (!leaf.active) continue;
        updateLeaf(leaf, time, field, dt);
        const illumination = illuminationAt(leaf, time);
        const sprite = sprites[leaf.palette];
        const margin = sprite.margin * leaf.scale;
        if (leaf.x - margin > width) {
          leaf.active = false;
          continue;
        }
        // An exiting leaf leaves room for the next staggered entry.
        const handoff = layout.target === 1 ? 1.05 : 0.95;
        if (leaf.x < width - margin * handoff) onRoute++;
        if (leaf.x + margin < 0) continue;
        drawLeaf(sprite, leaf.x, leaf.y, leaf.scale, leaf.rotation, leaf.glow, illumination);
      }

      if (time >= nextSpawn && onRoute < layout.target) {
        const free = leaves.find(leaf => !leaf.active);
        if (free) {
          spawn(free, time, field);
          scheduleSpawn(time);
        }
      }
    }

    // Apply contrast protection to the leaves only, leaving the page and wind untouched.
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = layout.readingMask;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    drawWind(width, height, field);
    context.globalCompositeOperation = 'destination-over';
    context.globalAlpha = 1;
    drawUndergrowth(time, field, staticFrame);
    context.globalCompositeOperation = 'source-over';
  }

  function resizeScene() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height || document.hidden) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, scene.maxPixelRatio,
      Math.sqrt(scene.maxCanvasPixels / (width * height)));
    if (!layout || width !== layout.width || height !== layout.height || pixelRatio !== layout.pixelRatio) {
      const previous = layout;
      const field = breezeAt(elapsed);
      const bounds = column.getBoundingClientRect();
      const span = Math.min(scene.leaf.size, width * 0.65, height * 0.66);
      const sprites = previous && previous.span === span && previous.pixelRatio === pixelRatio
        ? previous.sprites : buildSprites(span, pixelRatio);
      canvas.width = Math.ceil(width * pixelRatio);
      canvas.height = Math.ceil(height * pixelRatio);
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      const readingMask = context.createLinearGradient(0, 0, width, 0);
      const stop = (x, opacity) => readingMask.addColorStop(clamp(x / width, 0, 1),
        'rgb(0 0 0 / ' + opacity + ')');
      const compact = width < 700;
      stop(0, compact ? 0.52 : 1);
      stop(bounds.left - 40, compact ? 0.52 : 1);
      stop(bounds.left + 12, 0.18);
      stop(bounds.right - 12, 0.18);
      stop(bounds.right + 40, compact ? 0.52 : 1);
      stop(width, compact ? 0.52 : 1);

      const target = Math.max(1, Math.min(config.targetLeafCount, compact ? 1 : width < 1050 ? 3 : 6));
      const poolSize = target + (target === 1 ? 2 : 1);
      const gutter = width - bounds.right;
      layout = {
        width, height, pixelRatio, span, sprites, readingMask, target,
        readingLeft: bounds.left, readingRight: bounds.right,
        undergrowth: buildUndergrowth(width, height, bounds, pixelRatio),
        eddyScale: clamp(Math.min(width / 1100, height / 650), 0.5, 1),
        intervalScale: compact ? 0.7 : clamp(width / 1440, 0.6, 1),
        speedScale: clamp(width / 1440, 0.55, 1),
        sway: Math.min(72, height * 0.11),
        stillX: width * (scene.leaf.position.x + (1 - clamp(gutter / 330, 0, 1)) * 0.075),
      };

      if (!previous) {
        // Start with an already populated scene. All subsequent entries begin offscreen.
        for (let index = 0; index < poolSize; index++) leaves.push({ active: false });
        for (let index = 0; index < target; index++) {
          spawn(leaves[index], elapsed, field, true);
        }
        scheduleSpawn(elapsed);
        if (target === 1) nextSpawn = elapsed + (nextSpawn - elapsed) * 0.35;
      } else {
        if (layout.target < previous.target) {
          // Let excess leaves finish their current pass after resizing down.
          scheduleSpawn(elapsed);
        }
        while (leaves.length < poolSize) leaves.push({ active: false });
        for (const leaf of leaves) {
          if (!leaf.active) continue;
          const desiredX = leaf.x * (width / previous.width);
          updateLeaf(leaf, elapsed, field);
          leaf.origin += desiredX - leaf.x;
        }
      }
    }
    drawFrame(elapsed, reducedMotion.matches ? still : breezeAt(elapsed), reducedMotion.matches);
  }

  function animate(timestamp) {
    const dt = lastTime === undefined ? 0 : (timestamp - lastTime) / 1000;
    elapsed += dt;
    lastTime = timestamp;
    drawFrame(elapsed, breezeAt(elapsed), false, Math.min(dt, 0.1));
    frameId = window.requestAnimationFrame(animate);
  }

  function resize() {
    try {
      resizeScene();
      return true;
    } catch (error) {
      if (error !== spriteAllocationFailure) throw error;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      layout = undefined;
      canvas.width = 0;
      control.hidden = true;
      control.removeEventListener('click', togglePause);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncPlayback);
      reducedMotion.removeEventListener('change', syncPlayback);
      return false;
    }
  }

  function updatePlayback() {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    lastTime = undefined;
    if (!document.hidden && !reducedMotion.matches && !paused) {
      frameId = window.requestAnimationFrame(animate);
    }
  }

  function togglePause() {
    paused = !paused;
    control.textContent = paused ? 'resume animation' : 'pause animation';
    updatePlayback();
  }

  function syncPlayback() {
    control.hidden = reducedMotion.matches;
    if (!document.hidden && !resize()) return;
    updatePlayback();
  }

  control.addEventListener('click', togglePause);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', syncPlayback);
  reducedMotion.addEventListener('change', syncPlayback);
  syncPlayback();
})();
