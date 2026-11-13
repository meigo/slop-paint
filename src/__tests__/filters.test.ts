import { describe, expect, it } from "vitest";
import {
  FILTER_DEFAULTS,
  applyFilter,
  blurChannel,
  blurPlan,
  filterReach,
  posterizePalette,
  alphaStepLut,
  filterShared,
  colourToAlphaPixel,
  shadowOffset,
  filterMaxReach,
  fieldShare,
  filterRect,
  sameRect,
  BLUR_MAX,
  SHARPEN_MAX,
  SHADOW_BLUR_MAX,
  SHADOW_DISTANCE_MAX,
  HALFTONE_CELL_MAX,
  edgeBand,
  dotRadius,
  halftoneCoverage,
  hueSatPixel,
  levelsLut,
  lumaHistogram,
  type FilterSpec,
} from "../filters";

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < d.length; p += 4) d.set(rgba, p);
  return d;
}

function run(src: Uint8ClampedArray, w: number, h: number, spec: FilterSpec, lock = false) {
  const out = new Uint8ClampedArray(src.length);
  applyFilter(src, out, w, h, 0, 0, spec, 1, lock);
  return out;
}

const mean = (d: Uint8ClampedArray, ch: number) => {
  let s = 0;
  for (let p = ch; p < d.length; p += 4) s += d[p];
  return s / (d.length / 4);
};

describe("levelsLut", () => {
  it("is the identity at its defaults", () => {
    const lut = levelsLut(FILTER_DEFAULTS.levels);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });
  it("clips at the input points and maps to the output points", () => {
    const lut = levelsLut({ ...FILTER_DEFAULTS.levels, inBlack: 50, inWhite: 200, outBlack: 10 });
    expect(lut[0]).toBe(10);
    expect(lut[50]).toBe(10);
    expect(lut[200]).toBe(255);
    expect(lut[255]).toBe(255);
  });
  it("gamma above 1 lightens the midtones", () => {
    expect(levelsLut({ ...FILTER_DEFAULTS.levels, gamma: 2 })[128]).toBeGreaterThan(160);
    expect(levelsLut({ ...FILTER_DEFAULTS.levels, gamma: 0.5 })[128]).toBeLessThan(80);
  });
  it("output white below black inverts", () => {
    const lut = levelsLut({ ...FILTER_DEFAULTS.levels, outBlack: 255, outWhite: 0 });
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
  });
});

describe("lumaHistogram", () => {
  it("counts painted pixels by alpha and skips transparent ones", () => {
    const d = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 51, 9, 9, 9, 0]);
    const h = lumaHistogram(d);
    expect(h[255]).toBe(1);
    expect(h[0]).toBeCloseTo(0.2);
    expect(h[9]).toBe(0);
  });
});

describe("hueSatPixel", () => {
  const px = (r: number, g: number, b: number, hue: number, saturation: number, lightness = 0) => {
    const o = [0, 0, 0];
    hueSatPixel(r, g, b, { kind: "hueSat", hue, saturation, lightness }, o);
    return o;
  };
  it("leaves a colour alone at zero", () => {
    expect(px(200, 80, 30, 0, 0)).toEqual([200, 80, 30]);
  });
  /** OKLab lightness of an sRGB colour, 0–1 (for the tests: what the eye sees). */
  const lightness = ([r, g, b]: number[]) => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  };
  it("turns red toward green at +120°, as light as it was", () => {
    const o = px(220, 40, 40, 120, 0);
    expect(o[1]).toBeGreaterThan(o[0]);
    expect(o[1]).toBeGreaterThan(o[2]);
    expect(Math.abs(lightness(o) - lightness([220, 40, 40]))).toBeLessThan(0.01);
  });
  it("−100 saturation gives the grey of how light the colour looks", () => {
    for (const c of [
      [255, 0, 0],
      [200, 56, 96],
      [70, 130, 213],
      [139, 79, 139],
    ]) {
      const [r, g, b] = px(c[0], c[1], c[2], 0, -100);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(Math.abs(lightness([r, g, b]) - lightness(c))).toBeLessThan(0.005);
    }
  });
  it("−100 saturation keeps a red→blue blend smooth: no sudden step by the purple", () => {
    // The user's case, sampled across the overlap. HSL jumped 109 → 122 → 132 over three samples
    // (a dark valley with a light rim beside it). The gentle dip that is left is the blend's own:
    // mixed in gamma-encoded sRGB, the purple is a little darker than either end.
    const row = [
      [200, 56, 96],
      [189, 60, 103],
      [175, 60, 113],
      [159, 68, 125],
      [139, 79, 139],
      [121, 88, 155],
      [105, 97, 167],
      [90, 107, 182],
    ].map((c) => px(c[0], c[1], c[2], 0, -100)[0]);
    for (let i = 1; i < row.length; i++)
      expect(Math.abs(row[i] - row[i - 1])).toBeLessThanOrEqual(6);
  });
  it("+100 saturation doesn't colour a grey, and makes a colour as vivid as it goes", () => {
    expect(px(128, 128, 128, 0, 100)).toEqual([128, 128, 128]);
    const o = px(150, 110, 100, 0, 100);
    expect(Math.max(...o) === 255 || Math.min(...o) === 0).toBe(true); // at the gamut's edge
    expect(Math.abs(lightness(o) - lightness([150, 110, 100]))).toBeLessThan(0.01);
  });
  it("keeps every result inside sRGB with its lightness (a hue turn of a vivid colour)", () => {
    const o = px(255, 255, 0, 180, 0); // yellow's opposite at yellow's lightness can't be as vivid
    expect(Math.abs(lightness(o) - lightness([255, 255, 0]))).toBeLessThan(0.01);
  });
  it("lightness ±100 gives white / black", () => {
    expect(px(30, 90, 200, 0, 0, 100)).toEqual([255, 255, 255]);
    expect(px(30, 90, 200, 0, 0, -100)).toEqual([0, 0, 0]);
  });
});

describe("threshold", () => {
  const spec = FILTER_DEFAULTS.threshold;
  it("makes dark ink solid black and removes light on transparent paper", () => {
    const src = new Uint8ClampedArray([20, 20, 20, 200, 240, 240, 240, 255, 0, 0, 0, 20]);
    expect(Array.from(run(src, 3, 1, spec))).toEqual([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("judges a pixel as it looks on white: a faint black edge is light", () => {
    const src = new Uint8ClampedArray([0, 0, 0, 40]);
    expect(run(src, 1, 1, spec)[3]).toBe(0);
  });
  it("white paper keeps the layer's coverage", () => {
    const src = new Uint8ClampedArray([240, 240, 240, 255, 0, 0, 0, 0]);
    expect(Array.from(run(src, 2, 1, { ...spec, paper: "white" }))).toEqual([
      255, 255, 255, 255, 0, 0, 0, 0,
    ]);
  });
  it("alpha lock adds no alpha", () => {
    const src = new Uint8ClampedArray([0, 0, 0, 180]);
    expect(run(src, 1, 1, spec, true)[3]).toBe(180);
  });
});

describe("halftone", () => {
  it("dot radius grows with the tone, reaching the cell's corners at 1", () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const r = dotRadius(t, 10);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    expect(dotRadius(1, 10)).toBeGreaterThan(10 * Math.SQRT1_2 + 0.5 - 1e-6);
  });
  it("covers about as much as the tone, for dots and lines at any angle", () => {
    for (const shape of ["dots", "lines"] as const) {
      for (const angle of [0, 45, 15]) {
        for (const tone of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const rad = (angle * Math.PI) / 180;
          let s = 0;
          const N = 200;
          for (let y = 0; y < N; y++)
            for (let x = 0; x < N; x++)
              s += halftoneCoverage(x, y, tone, 10, Math.cos(rad), Math.sin(rad), shape);
          expect(s / (N * N)).toBeCloseTo(tone, 1);
        }
      }
    }
  });
  it("0 is no ink, 1 is solid", () => {
    expect(halftoneCoverage(3, 3, 0, 8, 1, 0, "dots")).toBe(0);
    expect(halftoneCoverage(3, 3, 1, 8, 1, 0, "dots")).toBe(1);
  });
  it("turns a grey fill into black dots on transparent; dots reach a cell past it at most", () => {
    const w = 64,
      h = 64;
    const src = solid(w, h, [128, 128, 128, 255]);
    const EMPTY = 16; // the top rows are empty
    for (let p = 0; p < w * 4 * EMPTY; p += 4) src[p + 3] = 0;
    const out = run(src, w, h, { ...FILTER_DEFAULTS.halftone, cell: 6 });
    for (let p = 0; p < w * 4 * (EMPTY - 7); p += 4) expect(out[p + 3]).toBe(0);
    expect(mean(out, 0)).toBe(0);
    const painted = out.subarray(w * 4 * (EMPTY + 8));
    expect(mean(painted, 3) / 255).toBeCloseTo(1 - 128 / 255, 1);
  });
  it("gives the same dots on the area App works on (ink bounds + reach) as on the whole canvas", () => {
    // A grey square on a big transparent canvas, at 45° with a big cell: the cells along its edge
    // straddle the area's border unless the reach covers them whole.
    const W = 200,
      H = 200,
      x0 = 70,
      y0 = 60,
      s = 50;
    const full = new Uint8ClampedArray(W * H * 4);
    for (let y = y0; y < y0 + s; y++)
      for (let x = x0; x < x0 + s; x++) full.set([90, 90, 90, 255], (y * W + x) * 4);
    const spec = { ...FILTER_DEFAULTS.halftone, cell: 24, angle: 45 } as const;
    const whole = new Uint8ClampedArray(full.length);
    applyFilter(full, whole, W, H, 0, 0, spec);
    const r = filterReach(spec);
    const ax = x0 - r,
      ay = y0 - r,
      aw = s + 2 * r,
      ah = s + 2 * r;
    expect(ax).toBeGreaterThanOrEqual(0);
    const area = new Uint8ClampedArray(aw * ah * 4);
    for (let y = 0; y < ah; y++)
      area.set(full.subarray(((ay + y) * W + ax) * 4, ((ay + y) * W + ax + aw) * 4), y * aw * 4);
    const part = new Uint8ClampedArray(area.length);
    applyFilter(area, part, aw, ah, ax, ay, spec);
    let diff = 0;
    for (let y = 0; y < ah; y++)
      for (let x = 0; x < aw; x++)
        if (part[(y * aw + x) * 4 + 3] !== whole[((ay + y) * W + ax + x) * 4 + 3]) diff++;
    expect(diff).toBe(0);
  });
  it("draws each dot round and in one colour, even over a change of tone and colour", () => {
    // Left of x = 34 a dark red, right of it a light blue: the step runs through the dots of the
    // column of cells round x = 32 (angle 0, cell 8: dot centres at multiples of 8).
    const w = 64,
      h = 64,
      cell = 8;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        src.set(x < 34 ? [150, 20, 20, 255] : [120, 170, 240, 255], (y * w + x) * 4);
    const spec = { ...FILTER_DEFAULTS.halftone, cell, angle: 0, ink: "colour" } as const;
    const out = run(src, w, h, spec);
    const at = (x: number, y: number) =>
      Array.from(out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));
    const cx = 32,
      cy = 32; // a dot centre, between pixels 31 and 32
    for (let d = 0; d < 4; d++) {
      // round: the same coverage either side of the centre, across and along the step
      expect(at(cx + d, cy)[3]).toBe(at(cx - 1 - d, cy)[3]);
      expect(at(cx, cy + d)[3]).toBe(at(cx, cy - 1 - d)[3]);
    }
    // flat: every solid pixel of that dot has the same colour
    const colours = new Set<string>();
    for (let y = cy - 3; y < cy + 3; y++)
      for (let x = cx - 3; x < cx + 3; x++)
        if (at(x, y)[3] === 255) colours.add(at(x, y).slice(0, 3).join());
    expect(colours.size).toBe(1);
  });
  it("white paper keeps alpha and mixes ink with white", () => {
    const src = solid(32, 32, [128, 128, 128, 255]);
    const out = run(src, 32, 32, { ...FILTER_DEFAULTS.halftone, paper: "white" });
    expect(mean(out, 3)).toBe(255);
    expect(mean(out, 0)).toBeGreaterThan(80);
    expect(mean(out, 0)).toBeLessThan(180);
  });
  it("reads see-through shading by its alpha: solid dots covering that share", () => {
    const src = solid(64, 64, [0, 0, 0, 77]); // black at 30%
    const out = run(src, 64, 64, { ...FILTER_DEFAULTS.halftone, cell: 6 });
    expect(mean(out, 3) / 255).toBeCloseTo(0.3, 1);
    let solidPx = 0;
    for (let p = 3; p < out.length; p += 4) if (out[p] === 255) solidPx++;
    expect(solidPx).toBeGreaterThan(64 * 64 * 0.15); // the dots' middles are opaque
  });
  it("with alpha lock, no dot gets more alpha than was there", () => {
    const src = solid(32, 32, [0, 0, 0, 77]);
    const out = run(src, 32, 32, FILTER_DEFAULTS.halftone, true);
    for (let p = 3; p < out.length; p += 4) expect(out[p]).toBeLessThanOrEqual(77);
  });
  it("white paper over see-through shading: solid dots, the paper at the layer's alpha", () => {
    const src = solid(64, 64, [0, 0, 0, 128]);
    const out = run(src, 64, 64, { ...FILTER_DEFAULTS.halftone, cell: 6, paper: "white" });
    let dot = 0,
      paper = 0;
    for (let p = 0; p < out.length; p += 4) {
      if (out[p + 3] === 255 && out[p] === 0) dot++;
      if (out[p + 3] === 128 && out[p] === 255) paper++;
    }
    expect(dot).toBeGreaterThan(0);
    expect(paper).toBeGreaterThan(0);
  });
});

describe("every filter but the blur", () => {
  it("keeps a transparent pixel transparent", () => {
    const src = new Uint8ClampedArray([0, 0, 0, 0]);
    const specs: FilterSpec[] = [
      { ...FILTER_DEFAULTS.levels, outBlack: 200 },
      { ...FILTER_DEFAULTS.hueSat, lightness: 100 },
      { ...FILTER_DEFAULTS.threshold, paper: "white" },
      { ...FILTER_DEFAULTS.halftone, paper: "white" },
      { kind: "posterize", colours: 2, alphaSteps: 0, smooth: false },
    ];
    for (const s of specs) expect(run(src, 1, 1, s)[3]).toBe(0);
  });
});

describe("hueSat over a buffer", () => {
  it("matches the per-pixel maths through its colour table", () => {
    const n = 5000;
    const src = new Uint8ClampedArray(n * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
    for (let i = 0; i < n; i++) src.set([rnd(), rnd(), rnd() & 0xf0, 255], i * 4);
    const spec = { kind: "hueSat", hue: 40, saturation: -30, lightness: 10 } as const;
    const out = run(src, n, 1, spec);
    const o = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      hueSatPixel(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], spec, o);
      expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]).toEqual(o);
    }
  });
});

describe("posterize", () => {
  const YELLOW = [245, 215, 90] as const,
    RED = [215, 75, 60] as const;
  /** Yellow paper with a red patch, and a blurred band between them. */
  function picture() {
    const w = 100,
      h = 1;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, Math.max(0, (x - 40) / 20));
      for (let c = 0; c < 3; c++) d[x * 4 + c] = Math.round(YELLOW[c] * (1 - t) + RED[c] * t);
      d[x * 4 + 3] = 255;
    }
    return { d, w, h };
  }

  it("keeps the layer's own colours, not a grid's", () => {
    const { d, w, h } = picture();
    const out = run(d, w, h, { kind: "posterize", colours: 2, alphaSteps: 0, smooth: false });
    expect(Array.from(out.subarray(0, 3))).toEqual([...YELLOW]);
    expect(Array.from(out.subarray(99 * 4, 99 * 4 + 3))).toEqual([...RED]);
    const seen = new Set<string>();
    for (let p = 0; p < out.length; p += 4) seen.add(out.subarray(p, p + 3).join());
    expect(seen.size).toBe(2);
  });

  it("gives at most `colours` colours, and fewer when the layer has fewer", () => {
    const { d } = picture();
    for (const k of [2, 4, 8]) expect(posterizePalette(d, k).length / 3).toBeLessThanOrEqual(k);
    expect(posterizePalette(solid(4, 4, [10, 200, 30, 255]), 6)).toEqual(
      new Uint8ClampedArray([10, 200, 30]),
    );
  });

  it("keeps the alpha and skips transparent pixels", () => {
    const src = new Uint8ClampedArray([200, 0, 0, 128, 0, 0, 255, 0, 0, 0, 200, 255]);
    const out = run(src, 3, 1, { kind: "posterize", colours: 2, alphaSteps: 0, smooth: false });
    expect(Array.from(out)).toEqual([200, 0, 0, 128, 0, 0, 255, 0, 0, 0, 200, 255]);
  });

  it("steps the alpha to the layer's own levels, transparent always one", () => {
    // A soft edge 1…254 around a solid core, plus paint laid at 60% (153).
    const px: number[] = [];
    for (let a = 1; a < 255; a++) px.push(a);
    for (let i = 0; i < 2000; i++) px.push(255);
    for (let i = 0; i < 2000; i++) px.push(153);
    const src = new Uint8ClampedArray(px.length * 4);
    px.forEach((a, i) => src.set([200, 0, 0, a], i * 4));
    const lut3 = alphaStepLut(src, 3);
    expect(new Set(lut3)).toEqual(new Set([0, 153, 255]));
    expect(lut3[0]).toBe(0);
    expect(lut3[20]).toBe(0);
    expect(lut3[160]).toBe(153);
    const lut2 = alphaStepLut(solid(1, 1, [0, 0, 0, 153]), 2);
    expect(lut2[153]).toBe(153);
    expect(lut2[60]).toBe(0);
    const out = run(src, px.length, 1, {
      kind: "posterize",
      colours: 2,
      alphaSteps: 3,
      smooth: false,
    });
    expect(new Set(Array.from(out.filter((_, i) => i % 4 === 3)))).toEqual(new Set([0, 153, 255]));
  });

  it("keeps the alpha under alpha lock", () => {
    const src = new Uint8ClampedArray([200, 0, 0, 40, 200, 0, 0, 255]);
    const out = run(
      src,
      2,
      1,
      { kind: "posterize", colours: 2, alphaSteps: 2, smooth: false },
      true,
    );
    expect([out[3], out[7]]).toEqual([40, 255]);
  });

  it("shares one palette and one set of alpha steps across layers", () => {
    // Two layers: the same red, one also holding blue, the other green.
    const a = new Uint8ClampedArray([200, 0, 0, 255, 200, 0, 0, 255, 0, 0, 200, 255]);
    const b = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 128, 0, 200, 0, 255]);
    const both = new Uint8ClampedArray([...a, ...b]);
    const spec = { kind: "posterize", colours: 3, alphaSteps: 2, smooth: false } as const;
    const sh = filterShared(spec, [a, b]);
    expect(sh.palette).toEqual(posterizePalette(both, 3));
    expect(sh.alphaLut).toEqual(alphaStepLut(both, 2));
    // Run with it, each layer's red is the same red.
    const oa = new Uint8ClampedArray(a.length),
      ob = new Uint8ClampedArray(b.length);
    applyFilter(a, oa, 3, 1, 0, 0, spec, 1, false, sh);
    applyFilter(b, ob, 3, 1, 0, 0, spec, 1, false, sh);
    expect(Array.from(oa.subarray(0, 3))).toEqual(Array.from(ob.subarray(0, 3)));
    expect(filterShared(FILTER_DEFAULTS.levels, [a, b])).toEqual({});
  });

  it("is the same every run", () => {
    const { d } = picture();
    expect(posterizePalette(d, 5)).toEqual(posterizePalette(d, 5));
  });
});

describe("Gaussian blur", () => {
  /** The spread (σ) of a blurred impulse along one row. */
  function measuredSigma(sigma: number) {
    const w = 401,
      h = 1;
    const a = new Float32Array(w);
    a[200] = 1;
    blurChannel(a, w, h, blurPlan(sigma), new Float32Array(w));
    let sum = 0,
      v = 0;
    for (let i = 0; i < w; i++) sum += a[i];
    for (let i = 0; i < w; i++) v += a[i] * (i - 200) ** 2;
    return { sum, sigma: Math.sqrt(v / sum) };
  }
  it("spreads by about σ, sampled or by boxes, and keeps the paint", () => {
    for (const s of [0.6, 1, 2.5, 3.5, 8, 20]) {
      const m = measuredSigma(s);
      expect(m.sum).toBeCloseTo(1, 4);
      expect(Math.abs(m.sigma - s) / s).toBeLessThan(0.08);
    }
  });
  it("does nothing below a quarter pixel", () => {
    expect(blurPlan(0.1).kind).toBe("none");
    expect(filterReach({ kind: "blur", radius: 0.1 })).toBe(0);
  });
  it("reaches as far as its kernel or boxes do, at the layer's density; others little or nothing", () => {
    expect(filterReach({ kind: "blur", radius: 2 })).toBe(6);
    expect(filterReach({ kind: "blur", radius: 1 }, 2)).toBe(6);
    expect(filterReach({ kind: "blur", radius: 10 })).toBeGreaterThanOrEqual(28);
    expect(filterReach(FILTER_DEFAULTS.halftone)).toBe(14); // dots: 1.5 cells (8) + 2
    expect(filterReach({ ...FILTER_DEFAULTS.halftone, shape: "lines" })).toBe(0);
    expect(filterReach(FILTER_DEFAULTS.levels)).toBe(0);
  });
  it("blurs paint into transparency without darkening its colour", () => {
    const w = 40,
      h = 40;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 15; y < 25; y++)
      for (let x = 15; x < 25; x++) src.set([255, 40, 0, 255], (y * w + x) * 4);
    const out = run(src, w, h, { kind: "blur", radius: 2 });
    let alpha = 0;
    for (let p = 0; p < out.length; p += 4) {
      alpha += out[p + 3];
      if (out[p + 3] > 2) {
        expect(out[p]).toBeGreaterThan(250);
        expect(Math.abs(out[p + 1] - 40)).toBeLessThan(4);
      }
    }
    expect(out[(14 * w + 20) * 4 + 3]).toBeGreaterThan(0); // spread past the edge
    expect(alpha / (255 * 100)).toBeCloseTo(1, 1); // and none lost
  });
  it("keeps a flat colour flat, up to the canvas edge", () => {
    const src = solid(30, 30, [90, 120, 200, 255]);
    const out = run(src, 30, 30, { kind: "blur", radius: 5 });
    for (let p = 0; p < out.length; p += 4)
      expect([out[p], out[p + 1], out[p + 2], out[p + 3]]).toEqual([90, 120, 200, 255]);
  });
  it("alpha lock keeps the alpha and blurs only the colour", () => {
    const w = 20,
      h = 1;
    const src = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) src.set(x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 128], x * 4);
    const out = run(src, w, h, { kind: "blur", radius: 2 }, true);
    for (let x = 0; x < w; x++) expect(out[x * 4 + 3]).toBe(src[x * 4 + 3]);
    expect(out[9 * 4]).toBeGreaterThan(0);
    expect(out[10 * 4]).toBeLessThan(255);
  });
});

describe("colour to alpha", () => {
  const WHITE = [255, 255, 255] as const;
  it("turns grey on white into see-through black, and white into nothing", () => {
    const o = [0, 0, 0, 0];
    colourToAlphaPixel(128, 128, 128, WHITE, o);
    expect(o.slice(0, 3)).toEqual([0, 0, 0]);
    expect(o[3]).toBeCloseTo(127 / 255, 3);
    colourToAlphaPixel(255, 255, 255, WHITE, o);
    expect(o[3]).toBe(0);
    colourToAlphaPixel(255, 0, 0, WHITE, o);
    expect(o).toEqual([255, 0, 0, 1]);
  });

  it("looks the same over the removed colour as before", () => {
    const key = [40, 200, 120] as const;
    const o = [0, 0, 0, 0];
    for (const px of [
      [10, 20, 30],
      [250, 128, 7],
      [40, 200, 121],
      [0, 255, 255],
    ]) {
      colourToAlphaPixel(px[0], px[1], px[2], key, o);
      for (let i = 0; i < 3; i++)
        expect(Math.abs(o[i] * o[3] + key[i] * (1 - o[3]) - px[i])).toBeLessThan(1.5);
    }
  });

  it("scales by the pixel's own alpha, and keeps the alpha under alpha lock", () => {
    const src = new Uint8ClampedArray([128, 128, 128, 200, 0, 0, 0, 0]);
    const out = run(src, 2, 1, FILTER_DEFAULTS.colourToAlpha);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 0, Math.round((127 / 255) * 200)]);
    expect(out[7]).toBe(0);
    expect(run(src, 2, 1, FILTER_DEFAULTS.colourToAlpha, true)[3]).toBe(200);
  });
});

describe("sharpen", () => {
  const spec = { kind: "sharpen", amount: 100, radius: 1 } as const;
  it("leaves a flat colour as it is, alpha included", () => {
    const src = solid(20, 20, [90, 140, 200, 180]);
    expect(run(src, 20, 20, spec)).toEqual(src);
  });

  it("raises the contrast across an edge", () => {
    const w = 20;
    const src = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) src.set(x < 10 ? [60, 60, 60, 255] : [180, 180, 180, 255], x * 4);
    const out = run(src, w, 1, spec);
    expect(out[9 * 4]).toBeLessThan(60);
    expect(out[10 * 4]).toBeGreaterThan(180);
    expect(out[0]).toBe(60);
  });

  it("puts no dark halo along the edge of paint on transparency", () => {
    const w = 20;
    const src = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < 10; x++) src.set([220, 40, 40, 255], x * 4);
    const out = run(src, w, 1, { ...spec, amount: 300 });
    for (let x = 0; x < 10; x++)
      expect(Array.from(out.subarray(x * 4, x * 4 + 4))).toEqual([220, 40, 40, 255]);
  });
});

describe("drop shadow and glow", () => {
  /** A 10×10 opaque red square in the middle of a transparent w×w area. */
  function square(w: number) {
    const d = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++)
        if (x >= w / 2 - 5 && x < w / 2 + 5 && y >= w / 2 - 5 && y < w / 2 + 5)
          d.set([200, 0, 0, 255], (y * w + x) * 4);
    return d;
  }
  const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

  it("falls away from the light, behind the paint", () => {
    const w = 60;
    const spec = { ...FILTER_DEFAULTS.shadow, blur: 0, distance: 8, angle: 135, opacity: 100 };
    const { dx, dy } = shadowOffset(spec);
    expect(dx).toBeGreaterThan(0); // light from the upper left: down-right
    expect(dy).toBeGreaterThan(0);
    const out = run(square(w), w, w, spec);
    expect(alphaAt(out, w, 30 + dx, 30 + dy)).toBe(255); // below-right of the square
    expect(
      Array.from(
        out.subarray(((w / 2 + 6) * w + (w / 2 + 6)) * 4, ((w / 2 + 6) * w + (w / 2 + 6)) * 4 + 3),
      ),
    ).toEqual([0, 0, 0]);
    expect(alphaAt(out, w, 30 - dx - 6, 30 - dy - 6)).toBe(0); // nothing up-left
    expect(Array.from(out.subarray((30 * w + 30) * 4, (30 * w + 30) * 4 + 4))).toEqual([
      200, 0, 0, 255,
    ]);
    expect(filterMaxReach("shadow")).toBeGreaterThanOrEqual(200);
  });

  it("glows evenly round the shape, more with spread", () => {
    const w = 80;
    const g = { ...FILTER_DEFAULTS.glow, size: 4, opacity: 100, spread: 0 };
    const out = run(square(w), w, w, g);
    const right = alphaAt(out, w, 40 + 8, 40),
      left = alphaAt(out, w, 40 - 9, 40);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(right - left)).toBeLessThanOrEqual(1);
    expect(alphaAt(run(square(w), w, w, { ...g, spread: 80 }), w, 48, 40)).toBeGreaterThan(right);
    expect(alphaAt(run(square(w), w, w, g, true), w, 48, 40)).toBe(0); // alpha lock
  });
});

describe("smooth edges (Threshold, Posterize)", () => {
  it("fieldShare: a hard step stays hard, a quantized ramp gets a partial pixel, a line stays", () => {
    const share = (vals: number[], x: number) => fieldShare(x, 0, vals.length, 1, (j) => vals[j]);
    const step = [100, 100, 100, -100, -100, -100];
    expect(step.map((_, x) => share(step, x))).toEqual([1, 1, 1, 0, 0, 0]);
    // A slow ramp stored in whole numbers (runs of 2–3 equal values): still a partial pixel.
    const ramp = Array.from({ length: 26 }, (_, x) => Math.round(5.2 - 0.4 * x));
    expect(ramp.map((_, x) => share(ramp, x)).some((v) => v > 0 && v < 1)).toBe(true);
    const line = [-100, -100, -100, 100, -100, -100, -100];
    expect(share(line, 3)).toBe(1);
    expect(share([3, 3, 3], 1)).toBe(1); // flat: by its sign
  });

  it("edgeBand marks the pixels within 2 px of a change, and nothing on a flat area", () => {
    const label = Uint8Array.from({ length: 12 }, (_, x) => (x < 6 ? 0 : 1));
    expect(Array.from(edgeBand(label, 12, 1))).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
    expect(Array.from(edgeBand(new Uint8Array(5), 5, 1))).toEqual([0, 0, 0, 0, 0]);
  });

  /** A row of `w` opaque greys, `fn(x)`. */
  const greys = (w: number, fn: (x: number) => number) => {
    const d = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) d.set([fn(x), fn(x), fn(x), 255], x * 4);
    return d;
  };
  const alphas = (d: Uint8ClampedArray) => Array.from(d.filter((_, i) => i % 4 === 3));

  it("Threshold: a soft ramp gets an antialiased cut, a hard step stays hard", () => {
    const ramp = greys(32, (x) => x * 8 + 2); // 2 … 250, the level 128 between x 15 and 16
    const hard = alphas(run(ramp, 32, 1, { ...FILTER_DEFAULTS.threshold, smooth: false }));
    const soft = alphas(run(ramp, 32, 1, FILTER_DEFAULTS.threshold));
    expect(hard.filter((a) => a > 0 && a < 255)).toEqual([]);
    const mid = soft.filter((a) => a > 0 && a < 255);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThanOrEqual(2);
    for (let x = 1; x < 32; x++) expect(soft[x]).toBeLessThanOrEqual(soft[x - 1]); // dark → light
    const step = greys(8, (x) => (x < 4 ? 0 : 255));
    expect(alphas(run(step, 8, 1, FILTER_DEFAULTS.threshold))).toEqual([
      255, 255, 255, 255, 0, 0, 0, 0,
    ]);
  });

  it("Posterize: a blend's border between two colours mixes just those two, nowhere else", () => {
    const w = 40,
      A = [220, 40, 40],
      B = [40, 80, 220];
    const d = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      d.set(
        [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, 255],
        x * 4,
      );
    }
    const spec = { kind: "posterize", colours: 2, alphaSteps: 0, smooth: true } as const;
    const out = run(d, w, 1, spec);
    const hardOut = run(d, w, 1, { ...spec, smooth: false });
    const pal = new Set<string>();
    for (let x = 0; x < w; x++) pal.add(hardOut.subarray(x * 4, x * 4 + 3).join());
    expect(pal.size).toBe(2);
    let mixed = 0;
    for (let x = 0; x < w; x++) if (!pal.has(out.subarray(x * 4, x * 4 + 3).join())) mixed++;
    expect(mixed).toBeGreaterThan(0);
    expect(mixed).toBeLessThanOrEqual(2);
    expect(Array.from(out.subarray(0, 3))).toEqual(Array.from(hardOut.subarray(0, 3)));
  });

  it("Posterize alpha steps: a soft edge's cut is antialiased; transparent stays transparent", () => {
    const w = 32;
    const d = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) d.set([200, 0, 0, Math.max(0, 255 - x * 10)], x * 4);
    const spec = { kind: "posterize", colours: 2, alphaSteps: 2, smooth: true } as const;
    const a = alphas(run(d, w, 1, spec));
    const levels = new Set(alphas(run(d, w, 1, { ...spec, smooth: false })));
    expect(levels.size).toBe(2);
    const between = a.filter((v) => !levels.has(v));
    expect(between.length).toBeGreaterThan(0);
    expect(between.length).toBeLessThanOrEqual(2);
    for (let x = 26; x < w; x++) expect(a[x]).toBe(0);
  });
});

describe("filterRect / filterMaxReach (the region App snapshots)", () => {
  const ink = { x: 10, y: 20, w: 30, h: 40 };

  it("grows the ink's bounds by the reach, inside the layer", () => {
    expect(filterRect(ink, null, 100, 100, 5)).toEqual({ x: 5, y: 15, w: 40, h: 50 });
    expect(filterRect(ink, null, 42, 62, 5)).toEqual({ x: 5, y: 15, w: 37, h: 47 });
    expect(filterRect(ink, null, 100, 100, 50)).toEqual({ x: 0, y: 0, w: 90, h: 100 });
  });

  it("cuts to the marquee grown by the reach too", () => {
    const marquee = { x: 30, y: 0, w: 5, h: 100 };
    expect(filterRect(ink, marquee, 100, 100, 0)).toEqual({ x: 30, y: 20, w: 5, h: 40 });
    expect(filterRect(ink, marquee, 100, 100, 3)).toEqual({ x: 27, y: 17, w: 11, h: 46 });
  });

  it("is null when the marquee misses the ink by more than the reach", () => {
    const marquee = { x: 60, y: 0, w: 5, h: 100 };
    expect(filterRect(ink, marquee, 100, 100, 10)).toBeNull();
    expect(filterRect(ink, marquee, 100, 100, 21)).not.toBeNull();
  });

  it("sameRect compares by value", () => {
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 5 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(null, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });

  // Every setting the dialog offers stays within the max reach, so the work area never leaves the
  // snapshot taken at open (a reach past it read and restored the wrong pixels, silently).
  it("no setting reaches past filterMaxReach", () => {
    const steps = (lo: number, hi: number, n = 60) =>
      Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
    for (const dpr of [1, 2]) {
      const max = (k: FilterSpec["kind"]) => filterMaxReach(k, dpr);
      for (const radius of steps(0.2, BLUR_MAX))
        expect(filterReach({ kind: "blur", radius }, dpr)).toBeLessThanOrEqual(max("blur"));
      for (const radius of steps(0.3, SHARPEN_MAX))
        expect(filterReach({ ...FILTER_DEFAULTS.sharpen, radius }, dpr)).toBeLessThanOrEqual(
          max("sharpen"),
        );
      for (const size of steps(0, SHADOW_BLUR_MAX))
        expect(filterReach({ ...FILTER_DEFAULTS.glow, size }, dpr)).toBeLessThanOrEqual(
          max("glow"),
        );
      for (const blur of steps(0, SHADOW_BLUR_MAX, 16))
        for (const distance of steps(0, SHADOW_DISTANCE_MAX, 16))
          for (const angle of steps(-180, 180, 24))
            expect(
              filterReach({ ...FILTER_DEFAULTS.shadow, blur, distance, angle }, dpr),
            ).toBeLessThanOrEqual(max("shadow"));
      for (const cell of steps(2, HALFTONE_CELL_MAX))
        for (const shape of ["dots", "lines"] as const)
          expect(
            filterReach({ ...FILTER_DEFAULTS.halftone, cell, shape }, dpr),
          ).toBeLessThanOrEqual(max("halftone"));
      for (const smooth of [true, false]) {
        expect(filterReach({ ...FILTER_DEFAULTS.threshold, smooth }, dpr)).toBeLessThanOrEqual(
          max("threshold"),
        );
        expect(filterReach({ ...FILTER_DEFAULTS.posterize, smooth }, dpr)).toBeLessThanOrEqual(
          max("posterize"),
        );
      }
      for (const k of ["levels", "hueSat", "colourToAlpha"] as const)
        expect(filterReach(FILTER_DEFAULTS[k], dpr)).toBe(max(k));
    }
  });
});
