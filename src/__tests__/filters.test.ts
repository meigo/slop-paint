import { describe, expect, it } from "vitest";
import {
  FILTER_DEFAULTS,
  applyFilter,
  blurChannel,
  blurPlan,
  filterReach,
  posterizePalette,
  alphaStepLut,
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
  it("turns red to green at +120°", () => {
    expect(px(255, 0, 0, 120, 0)).toEqual([0, 255, 0]);
  });
  it("−100 saturation gives a grey", () => {
    const [r, g, b] = px(255, 0, 0, 0, -100);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
  it("+100 saturation doesn't colour a grey", () => {
    expect(px(128, 128, 128, 0, 100)).toEqual([128, 128, 128]);
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
  it("turns a grey fill into black dots on transparent, cut to the shape", () => {
    const w = 64,
      h = 64;
    const src = solid(w, h, [128, 128, 128, 255]);
    for (let p = 0; p < 64 * 4 * 8; p += 4) src[p + 3] = 0; // the top 8 rows are empty
    const out = run(src, w, h, { ...FILTER_DEFAULTS.halftone, cell: 6 });
    for (let p = 0; p < 64 * 4 * 8; p += 4) expect(out[p + 3]).toBe(0);
    expect(mean(out, 0)).toBe(0);
    const painted = out.subarray(64 * 4 * 8);
    expect(mean(painted, 3) / 255).toBeCloseTo(1 - 128 / 255, 1);
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
      { kind: "posterize", colours: 2, alphaSteps: 0 },
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
    const out = run(d, w, h, { kind: "posterize", colours: 2, alphaSteps: 0 });
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
    const out = run(src, 3, 1, { kind: "posterize", colours: 2, alphaSteps: 0 });
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
    const out = run(src, px.length, 1, { kind: "posterize", colours: 2, alphaSteps: 3 });
    expect(new Set(Array.from(out.filter((_, i) => i % 4 === 3)))).toEqual(new Set([0, 153, 255]));
  });

  it("keeps the alpha under alpha lock", () => {
    const src = new Uint8ClampedArray([200, 0, 0, 40, 200, 0, 0, 255]);
    const out = run(src, 2, 1, { kind: "posterize", colours: 2, alphaSteps: 2 }, true);
    expect([out[3], out[7]]).toEqual([40, 255]);
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
  it("reaches as far as its kernel or boxes do, at the layer's density; other filters reach nothing", () => {
    expect(filterReach({ kind: "blur", radius: 2 })).toBe(6);
    expect(filterReach({ kind: "blur", radius: 1 }, 2)).toBe(6);
    expect(filterReach({ kind: "blur", radius: 10 })).toBeGreaterThanOrEqual(28);
    expect(filterReach(FILTER_DEFAULTS.halftone)).toBe(0);
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
