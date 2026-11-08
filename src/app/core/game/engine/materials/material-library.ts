import { Color3, DynamicTexture, Material, Scene, StandardMaterial, Texture } from '@babylonjs/core';
import { GraphicsQuality, Rgb, SurfaceMaterialId } from '../../models';
import {
  Ctx2D,
  blockWallSurface,
  brushedMetalSurface,
  canvasTexture,
  carpetSurface,
  ceilingTileSurface,
  concreteSurface,
  drawFogOutside,
  drawLeaves,
  fabricSurface,
  generateSurface,
  linoleumSurface,
  paintSurface,
  terrazzoSurface,
  woodGrainSurface,
  woodPanelSurface,
} from './procedural-textures';
import { SURFACE_RECIPES, SurfacePixels, renderSurfacePixels } from './surface-pixels';
import { texturesFromPixels } from './procedural-textures';
import type { ProceduralWorkers } from '../../workers/procedural-pool';

/** Max lights per material: room lights (<=4) + flashlight + ambient fill. */
export const MAX_LIGHTS = 6;

export type PropMaterialId =
  | 'laminate'
  | 'wood-dark'
  | 'wood-light'
  | 'metal'
  | 'metal-dark'
  | 'metal-brushed'
  | 'chrome'
  | 'plastic-beige'
  | 'plastic-dark'
  | 'plastic-white'
  | 'fabric-partition'
  | 'fabric-chair'
  | 'fabric-curtain'
  | 'leather'
  | 'glass'
  | 'paper'
  | 'cardboard'
  | 'terracotta'
  | 'soil'
  | 'rubber'
  | 'brass'
  | 'frame-gold'
  | 'frame-black'
  | 'whiteboard'
  | 'red-paint'
  | 'yellow-plastic'
  | 'water-blue'
  | 'concrete-raw'
  | 'void'
  | 'figure'
  | 'emissive-panel'
  | 'emissive-exit'
  | 'emissive-red'
  | 'emissive-green'
  | 'emissive-amber'
  | 'emissive-screen-off'
  | 'outside-fog'
  | 'leaves-fern'
  | 'leaves-ficus'
  | 'leaves-red'
  | 'binder-mix';



export interface MaterialOptions {
  diffuse?: Rgb;
  specular?: number;
  specularPower?: number;
  emissive?: Rgb;
  alpha?: number;
  texture?: Texture;
  bump?: Texture;
  bumpLevel?: number;
  backFaceCulling?: boolean;
  disableLighting?: boolean;
  alphaTest?: boolean;
}

const c3 = (rgb: Rgb) => new Color3(rgb[0], rgb[1], rgb[2]);

/**
 * Owns every material and procedural texture. Surface textures are generated lazily
 * (only what the stage uses) at a resolution matched to the graphics preset.
 */
export class MaterialLibrary {
  private readonly surfaces = new Map<SurfaceMaterialId, StandardMaterial>();
  private readonly props = new Map<PropMaterialId, StandardMaterial>();
  private readonly owned: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly textureSize: number;

  constructor(private readonly scene: Scene, quality: GraphicsQuality) {
    this.textureSize = quality === 'low' ? 256 : 512;
  }

  create(name: string, o: MaterialOptions): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.maxSimultaneousLights = MAX_LIGHTS;
    m.diffuseColor = o.diffuse ? c3(o.diffuse) : new Color3(1, 1, 1);
    const spec = o.specular ?? 0.08;
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = o.specularPower ?? 32;
    if (o.emissive) m.emissiveColor = c3(o.emissive);
    if (o.texture) m.diffuseTexture = o.texture;
    if (o.bump) {
      m.bumpTexture = o.bump;
      m.bumpTexture.level = o.bumpLevel ?? 0.6;
    }
    if (o.alpha !== undefined && o.alpha < 1) m.alpha = o.alpha;
    if (o.alphaTest && o.texture) {
      o.texture.hasAlpha = true;
      // Babylon compares the *material* alpha in its alpha test unless alpha comes from the texture.
      m.useAlphaFromDiffuseTexture = true;
      m.transparencyMode = Material.MATERIAL_ALPHATEST;
      m.alphaCutOff = 0.45;
    }
    m.backFaceCulling = o.backFaceCulling ?? true;
    if (o.disableLighting) m.disableLighting = true;
    this.owned.push(m);
    return m;
  }

  /** Renders a surface (in a worker when available) and creates its material. */
  async prepareSurface(id: SurfaceMaterialId, workers: ProceduralWorkers | null): Promise<void> {
    if (this.surfaces.has(id)) return;
    let pixels: SurfacePixels | null = null;
    if (workers) {
      try {
        pixels = await workers.surface(id, this.textureSize);
      } catch (err) {
        console.warn(`[materials] worker failed for ${id}; rendering on the main thread`, err);
      }
    }
    if (!this.surfaces.has(id)) this.surfaceFromPixels(id, pixels ?? renderSurfacePixels(SURFACE_RECIPES[id].build(this.textureSize), true));
  }

  surface(id: SurfaceMaterialId): StandardMaterial {
    const existing = this.surfaces.get(id);
    if (existing) return existing;
    return this.surfaceFromPixels(id, renderSurfacePixels(SURFACE_RECIPES[id].build(this.textureSize), true));
  }

  private surfaceFromPixels(id: SurfaceMaterialId, pixels: SurfacePixels): StandardMaterial {
    const recipe = SURFACE_RECIPES[id];
    const maps = texturesFromPixels(this.scene, id, pixels);
    this.textures.push(maps.diffuse);
    if (maps.bump) this.textures.push(maps.bump);
    const m = this.create(`surface-${id}`, {
      texture: maps.diffuse,
      bump: maps.bump,
      bumpLevel: 0.55,
      specular: recipe.specular,
      specularPower: 24,
      // Ceilings get a little self-illumination in place of light bounced off the floor.
      emissive: id.startsWith('ceiling') ? [0.1, 0.1, 0.09] : undefined,
    });
    this.surfaces.set(id, m);
    return m;
  }

  surfaceScale(id: SurfaceMaterialId): { scale: number; fullHeight: boolean } {
    const r = SURFACE_RECIPES[id];
    return { scale: r.scale, fullHeight: !!r.fullHeight };
  }

  get(id: PropMaterialId): StandardMaterial {
    const existing = this.props.get(id);
    if (existing) return existing;
    const m = this.buildProp(id);
    this.props.set(id, m);
    return m;
  }

  private tex(maps: { diffuse: Texture; bump?: Texture }): { texture: Texture; bump?: Texture } {
    this.textures.push(maps.diffuse);
    if (maps.bump) this.textures.push(maps.bump);
    return { texture: maps.diffuse, bump: maps.bump };
  }

  private buildProp(id: PropMaterialId): StandardMaterial {
    const s = this.scene;
    switch (id) {
      case 'laminate':
        return this.create(id, { ...this.tex(generateSurface(s, id, woodGrainSurface([168, 140, 104], 51), false)), specular: 0.18 });
      case 'wood-dark':
        return this.create(id, { ...this.tex(generateSurface(s, id, woodGrainSurface([86, 54, 34], 52), false)), specular: 0.25, specularPower: 48 });
      case 'wood-light':
        return this.create(id, { ...this.tex(generateSurface(s, id, woodGrainSurface([190, 160, 120], 53), false)), specular: 0.12 });
      case 'metal':
        return this.create(id, { diffuse: [0.55, 0.56, 0.56], specular: 0.35, specularPower: 64 });
      case 'metal-dark':
        return this.create(id, { diffuse: [0.18, 0.19, 0.2], specular: 0.3, specularPower: 48 });
      case 'metal-brushed':
        return this.create(id, { ...this.tex(generateSurface(s, id, brushedMetalSurface(54), true)), specular: 0.5, specularPower: 64, bumpLevel: 0.2 });
      case 'chrome':
        return this.create(id, { diffuse: [0.7, 0.72, 0.74], specular: 0.9, specularPower: 128 });
      case 'plastic-beige':
        return this.create(id, { diffuse: [0.72, 0.68, 0.58], specular: 0.15, specularPower: 24 });
      case 'plastic-dark':
        return this.create(id, { diffuse: [0.1, 0.1, 0.11], specular: 0.2, specularPower: 32 });
      case 'plastic-white':
        return this.create(id, { diffuse: [0.85, 0.85, 0.82], specular: 0.2, specularPower: 32 });
      case 'fabric-partition':
        return this.create(id, { ...this.tex(generateSurface(s, id, fabricSurface([110, 118, 126], 55), true)), specular: 0.01, bumpLevel: 0.4 });
      case 'fabric-chair':
        return this.create(id, { ...this.tex(generateSurface(s, id, fabricSurface([46, 50, 60], 56), true)), specular: 0.02, bumpLevel: 0.4 });
      case 'fabric-curtain':
        return this.create(id, { ...this.tex(generateSurface(s, id, fabricSurface([120, 96, 70], 57), true)), specular: 0.01, backFaceCulling: false });
      case 'leather':
        return this.create(id, { diffuse: [0.16, 0.09, 0.06], specular: 0.35, specularPower: 40 });
      case 'glass':
        return this.create(id, { diffuse: [0.55, 0.65, 0.66], alpha: 0.18, specular: 0.9, specularPower: 128, backFaceCulling: false });
      case 'paper':
        return this.create(id, { diffuse: [0.9, 0.88, 0.82], specular: 0.02 });
      case 'cardboard':
        return this.create(id, { diffuse: [0.58, 0.45, 0.3], specular: 0.03 });
      case 'terracotta':
        return this.create(id, { diffuse: [0.56, 0.3, 0.2], specular: 0.05 });
      case 'soil':
        return this.create(id, { diffuse: [0.16, 0.11, 0.08], specular: 0 });
      case 'rubber':
        return this.create(id, { diffuse: [0.06, 0.06, 0.06], specular: 0.05 });
      case 'brass':
        return this.create(id, { diffuse: [0.66, 0.52, 0.24], specular: 0.8, specularPower: 96 });
      case 'frame-gold':
        return this.create(id, { diffuse: [0.55, 0.42, 0.2], specular: 0.6, specularPower: 64 });
      case 'frame-black':
        return this.create(id, { diffuse: [0.05, 0.05, 0.05], specular: 0.2 });
      case 'whiteboard':
        return this.create(id, { diffuse: [0.92, 0.93, 0.93], specular: 0.5, specularPower: 64 });
      case 'red-paint':
        return this.create(id, { diffuse: [0.6, 0.08, 0.06], specular: 0.4, specularPower: 48 });
      case 'yellow-plastic':
        return this.create(id, { diffuse: [0.85, 0.65, 0.1], specular: 0.2 });
      case 'water-blue':
        return this.create(id, { diffuse: [0.45, 0.6, 0.8], alpha: 0.55, specular: 0.8, specularPower: 96 });
      case 'concrete-raw':
        return this.create(id, { ...this.tex(generateSurface(s, id, concreteSurface([110, 108, 104], 58, 256), true)), specular: 0.03 });
      case 'void':
        return this.create(id, { diffuse: [0, 0, 0], specular: 0, disableLighting: true });
      case 'figure':
        return this.create(id, { diffuse: [0.02, 0.02, 0.025], specular: 0.05 });
      case 'emissive-panel':
        return this.create(id, { diffuse: [1, 1, 1], emissive: [0.95, 0.97, 1], specular: 0, disableLighting: true });
      case 'emissive-exit':
        return this.create(id, { diffuse: [0.1, 0.9, 0.3], emissive: [0.15, 0.95, 0.35], disableLighting: true });
      case 'emissive-red':
        return this.create(id, { diffuse: [1, 0.1, 0.05], emissive: [1, 0.12, 0.06], disableLighting: true });
      case 'emissive-green':
        return this.create(id, { diffuse: [0.1, 1, 0.3], emissive: [0.15, 1, 0.35], disableLighting: true });
      case 'emissive-amber':
        return this.create(id, { diffuse: [1, 0.6, 0.15], emissive: [1, 0.62, 0.2], disableLighting: true });
      case 'emissive-screen-off':
        return this.create(id, { diffuse: [0.03, 0.04, 0.04], specular: 0.6, specularPower: 96 });
      case 'outside-fog': {
        const tex = canvasTexture(s, 'outside-fog', 512, 256, (ctx, w, h) => drawFogOutside(ctx, w, h, 61));
        this.textures.push(tex);
        const m = this.create(id, { texture: tex, emissive: [1, 1, 1], disableLighting: true });
        m.emissiveTexture = tex;
        return m;
      }
      case 'leaves-fern':
      case 'leaves-ficus':
      case 'leaves-red': {
        const kind = id === 'leaves-fern' ? 'fern' : id === 'leaves-ficus' ? 'ficus' : 'red';
        const tex = canvasTexture(s, id, 256, 256, (ctx, w, h) => drawLeaves(ctx, w, h, kind, id.length * 7), { alpha: true });
        this.textures.push(tex);
        return this.create(id, { texture: tex, alphaTest: true, specular: kind === 'red' ? 0.4 : 0.15, specularPower: 32, backFaceCulling: false });
      }
      case 'binder-mix': {
        const tex = canvasTexture(s, id, 256, 64, (ctx, w, h) => {
          const colors = ['#2b3f5c', '#5c2b2b', '#2f4d33', '#6b6b6b', '#1f1f1f', '#7a6a3a'];
          for (let x = 0; x < w; x += 16) {
            ctx.fillStyle = colors[(x / 16) % colors.length];
            ctx.fillRect(x, 0, 15, h);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillRect(x + 4, h * 0.6, 7, 10);
          }
        });
        this.textures.push(tex);
        return this.create(id, { texture: tex, specular: 0.1 });
      }
    }
  }

  /** A per-instance material whose diffuse (and optionally emissive) is a canvas drawing. */
  canvasMaterial(
    name: string,
    width: number,
    height: number,
    draw: (ctx: Ctx2D, w: number, h: number) => void,
    options: { emissive?: boolean; specular?: number; alpha?: boolean } = {},
  ): { material: StandardMaterial; texture: DynamicTexture } {
    const texture = canvasTexture(this.scene, `${name}-tex`, width, height, draw, { alpha: options.alpha });
    this.textures.push(texture);
    const material = this.create(name, {
      texture,
      specular: options.specular ?? 0.05,
      alphaTest: options.alpha,
      emissive: options.emissive ? [1, 1, 1] : undefined,
      disableLighting: options.emissive,
    });
    if (options.emissive) material.emissiveTexture = texture;
    return { material, texture };
  }

  /** Releases a single per-instance material + its textures. */
  release(material: StandardMaterial): void {
    material.diffuseTexture?.dispose();
    material.emissiveTexture?.dispose();
    material.dispose();
  }

  dispose(): void {
    for (const m of this.owned) m.dispose(false, false);
    for (const t of this.textures) t.dispose();
    this.owned.length = 0;
    this.textures.length = 0;
    this.surfaces.clear();
    this.props.clear();
  }
}
