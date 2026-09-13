// loader.ts — asynchronous loading of the curated `meine-tank` textures from
// `frontend/public/textures/meine-tank/`. Display-only: failure of a single texture
// degrades that element, never throws.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/textures/loader.ts
import { MEINE_TANK_TEXTURES, type AssetKind, type TextureAsset } from "./manifest.ts";

export interface LoadedTexture {
  asset: TextureAsset;
  image: HTMLImageElement;
  width: number;
  height: number;
  /** Frame count (1 for static). */
  frames: number;
}

export interface TextureStore {
  base: string;
  all: Map<string, LoadedTexture>;
  get(name: string): LoadedTexture | undefined;
  /** Loaded textures of a kind, in manifest order. */
  ofKind(kind: AssetKind): LoadedTexture[];
  /** True when every declared texture loaded successfully. */
  complete: boolean;
}

function defaultBase(): string {
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  return `${env?.BASE_URL ?? "/"}textures/meine-tank/`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`meine-tank: cannot load ${url}`));
    img.src = url;
  });
}

/** Load all declared textures in parallel, tolerating individual failures. */
export async function loadTextureStore(base = defaultBase()): Promise<TextureStore> {
  const all = new Map<string, LoadedTexture>();
  let failed = 0;
  await Promise.all(
    MEINE_TANK_TEXTURES.map(async (asset) => {
      try {
        const image = await loadImage(`${base}${asset.kind}/${asset.name}.png`);
        all.set(asset.name, {
          asset,
          image,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          frames: asset.animated ?? 1,
        });
      } catch {
        failed++;
      }
    }),
  );
  return {
    base,
    all,
    get: (name) => all.get(name),
    ofKind: (kind) =>
      MEINE_TANK_TEXTURES.filter((a) => a.kind === kind)
        .map((a) => all.get(a.name))
        .filter((t): t is LoadedTexture => !!t),
    complete: failed === 0,
  };
}

export default loadTextureStore;
