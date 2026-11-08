import {
  Camera,
  Color3,
  Color4,
  ColorCurves,
  DefaultRenderingPipeline,
  Engine,
  ImageProcessingConfiguration,
  SSAO2RenderingPipeline,
  Scene,
} from '@babylonjs/core';
import { AttentionLevelConfig, GameSettings, GraphicsQuality } from '../models';

/**
 * Engine + scene creation, post-processing and graphics presets.
 * Low:    80% resolution, no bloom/AO/shadows, grain + vignette only.
 * Medium: native resolution, bloom, FXAA, grain, vignette, subtle chromatic aberration.
 * High:   + SSAO (WebGL2), MSAA x4, flashlight shadows (see GameEngine).
 */
export class RenderManager {
  readonly engine: Engine;
  readonly scene: Scene;
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private camera: Camera | null = null;
  private quality: GraphicsQuality = 'medium';
  private post = true;
  private attentionFx = 0;
  private fade = 0;
  private readonly onResize = () => this.engine.resize();

  constructor(canvas: HTMLCanvasElement) {
    if (!Engine.isSupported()) throw new Error('WebGL is not supported by this browser or graphics driver.');
    this.engine = new Engine(canvas, true, { stencil: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }, false);
    this.engine.enableOfflineSupport = false;
    this.scene = new Scene(this.engine);
    const s = this.scene;
    s.clearColor = new Color4(0.012, 0.013, 0.016, 1);
    s.ambientColor = new Color3(0.06, 0.06, 0.07);
    s.fogMode = Scene.FOGMODE_EXP2;
    s.fogColor = new Color3(0.035, 0.036, 0.04);
    s.fogDensity = 0.028;
    s.skipPointerMovePicking = true;
    s.autoClear = true;
    s.autoClearDepthAndStencil = true;
    const ip = s.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.3;
    ip.contrast = 1.18;
    window.addEventListener('resize', this.onResize);
  }

  get webGL2(): boolean {
    return this.engine.webGLVersion >= 2;
  }

  attachCamera(camera: Camera): void {
    this.camera = camera;
  }

  applySettings(settings: GameSettings): void {
    const qualityChanged = settings.graphicsQuality !== this.quality || !this.pipeline;
    this.quality = settings.graphicsQuality;
    this.post = settings.postProcessing;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scaling = this.quality === 'low' ? 1.25 : this.quality === 'medium' ? 1 : 1 / Math.min(dpr, 1.5);
    this.engine.setHardwareScalingLevel(scaling);
    if (qualityChanged) this.buildPipeline();
    this.configurePipeline();
  }

  private buildPipeline(): void {
    if (!this.camera) return;
    this.pipeline?.dispose();
    this.ssao?.dispose();
    this.ssao = null;
    const p = new DefaultRenderingPipeline('main', true, this.scene, [this.camera]);
    this.pipeline = p;
    if (this.quality === 'high' && this.webGL2) {
      try {
        const ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera]);
        ssao.radius = 1.4;
        ssao.totalStrength = 1.1;
        ssao.base = 0.12;
        ssao.samples = 12;
        ssao.maxZ = 40;
        this.ssao = ssao;
      } catch (err) {
        console.warn('[render] SSAO unavailable', err);
      }
    }
  }

  private configurePipeline(): void {
    const p = this.pipeline;
    if (!p) return;
    const q = this.quality;
    const on = this.post;
    const fx = this.attentionFx;
    p.samples = q === 'high' ? 4 : 1;
    p.fxaaEnabled = q !== 'low';
    p.bloomEnabled = on && q !== 'low';
    p.bloomThreshold = 0.72;
    p.bloomWeight = 0.32 + fx * 0.1;
    p.bloomKernel = q === 'high' ? 64 : 40;
    p.bloomScale = 0.5;
    p.grainEnabled = on;
    p.grain.intensity = 9 + fx * 10;
    p.grain.animated = true;
    p.chromaticAberrationEnabled = on && q !== 'low';
    p.chromaticAberration.aberrationAmount = 14 + fx * 40;
    p.chromaticAberration.radialIntensity = 0.7;
    p.imageProcessingEnabled = true;
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.3 * (1 - this.fade);
    ip.contrast = 1.2;
    ip.vignetteEnabled = on;
    ip.vignetteWeight = 2.4 + fx * 1.6;
    ip.vignetteStretch = 0.45;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.colorCurvesEnabled = on;
    if (on) {
      const curves = new ColorCurves();
      curves.globalSaturation = -22 - fx * 18;
      curves.shadowsHue = 170;
      curves.shadowsDensity = 22;
      curves.shadowsSaturation = 40;
      curves.highlightsHue = 45;
      curves.highlightsDensity = 18;
      curves.highlightsSaturation = 30;
      ip.colorCurves = curves;
    }
    if (this.ssao) this.scene.postProcessRenderPipelineManager[on ? 'attachCamerasToRenderPipeline' : 'detachCamerasFromRenderPipeline']('ssao', this.camera ?? []);
  }

  setAttention(config: AttentionLevelConfig, escalating: boolean): void {
    this.attentionFx = escalating ? 1.2 : config.postFxIntensity;
    this.scene.fogDensity = config.fogDensity;
    this.configurePipeline();
  }

  /** 0 = normal, 1 = black. Used by intro / endings. */
  setFade(fade: number): void {
    this.fade = Math.max(0, Math.min(1, fade));
    if (this.pipeline) this.pipeline.imageProcessing.exposure = 1.3 * (1 - this.fade);
    else this.scene.imageProcessingConfiguration.exposure = 1.3 * (1 - this.fade);
  }

  get quality_(): GraphicsQuality {
    return this.quality;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.engine.stopRenderLoop();
    this.pipeline?.dispose();
    this.ssao?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
