import { AbstractMesh, Mesh, Scene } from '@babylonjs/core';
import { PropPlacement, PropType, RoomDefinition, StageDefinition } from '../../models';
import { MaterialLibrary } from '../materials/material-library';
import { BuiltProp, CAMERA_ONLY_LAYER, PropBuildContext, PropBuilder, PropKit } from './prop-kit';
import * as F from './props/fixtures';
import * as U from './props/furniture';
import * as S from './props/special';

/**
 * Builder table. Typed as Record<PropType, PropBuilder> so adding a PropType without a builder
 * is a compile error.
 */
const BUILDERS: Record<PropType, PropBuilder> = {
  desk: U.buildDesk,
  'cubicle-desk': U.buildCubicleDesk,
  'executive-desk': U.buildExecutiveDesk,
  'reception-desk': U.buildReceptionDesk,
  'office-chair': U.buildOfficeChair,
  'waiting-chair': U.buildWaitingChair,
  'conference-table': U.buildConferenceTable,
  computer: F.buildComputer,
  terminal: F.buildTerminal,
  phone: F.buildPhone,
  'desk-lamp': F.buildDeskLamp,
  plant: F.buildPlant,
  'filing-cabinet': U.buildFilingCabinet,
  bookshelf: U.buildBookshelf,
  'metal-shelf': U.buildMetalShelf,
  'archive-shelf': U.buildArchiveShelf,
  boxes: U.buildBoxes,
  whiteboard: F.buildWhiteboard,
  'projector-screen': F.buildProjectorScreen,
  'water-cooler': F.buildWaterCooler,
  printer: F.buildPrinter,
  'vending-machine': F.buildVendingMachine,
  'coffee-machine': F.buildCoffeeMachine,
  fridge: F.buildFridge,
  microwave: F.buildMicrowave,
  'kitchen-counter': U.buildKitchenCounter,
  'dining-table': U.buildDiningTable,
  painting: F.buildPainting,
  poster: F.buildPoster,
  'wall-sign': F.buildWallSign,
  note: F.buildNote,
  calendar: F.buildCalendar,
  'wall-clock': F.buildWallClock,
  'exit-sign': F.buildExitSign,
  'fire-extinguisher': F.buildFireExtinguisher,
  'trash-can': F.buildTrashCan,
  bench: U.buildBench,
  'security-desk': U.buildSecurityDesk,
  'server-rack': F.buildServerRack,
  logbook: F.buildLogbook,
  nameplate: F.buildNameplate,
  'photo-frame': F.buildPhotoFrame,
  'desk-fan': F.buildDeskFan,
  curtains: F.buildCurtains,
  'pa-speaker': F.buildPaSpeaker,
  'badge-reader': F.buildBadgeReader,
  'elevator-call-panel': F.buildElevatorCallPanel,
  'elevator-indicator': F.buildElevatorIndicator,
  'elevator-car-panel': F.buildElevatorCarPanel,
  'end-wall': S.buildEndWall,
  'corridor-extension': S.buildCorridorExtension,
  'fake-door': S.buildFakeDoor,
  'closet-vignette': S.buildClosetVignette,
  figure: S.buildFigure,
  'mop-bucket': F.buildMopBucket,
  ladder: F.buildLadder,
  'breaker-panel': F.buildBreakerPanel,
  'key-hook': F.buildKeyHook,
  memo: F.buildMemo,
  'water-fountain': F.buildWaterFountain,
  'fire-alarm': F.buildFireAlarm,
  'front-doors': S.buildFrontDoors,
  'ceiling-vent': F.buildCeilingVent,
  'wall-map': F.buildWallMap,
  radiator: F.buildRadiator,
  'umbrella-stand': F.buildUmbrellaStand,
  mug: F.buildMug,
  'paper-stack': F.buildPaperStack,
};

/** Props whose meshes are too small/decorative to block line of sight. */
const NON_OCCLUDING: ReadonlySet<PropType> = new Set<PropType>([
  'mug', 'paper-stack', 'note', 'nameplate', 'photo-frame', 'memo', 'phone', 'desk-lamp', 'logbook', 'key-hook',
  'badge-reader', 'fire-alarm', 'calendar', 'wall-clock', 'poster', 'painting', 'wall-sign', 'ceiling-vent', 'exit-sign',
  'pa-speaker', 'plant', 'trash-can', 'mug', 'office-chair', 'waiting-chair', 'figure', 'curtains',
]);

export interface FactoryHooks {
  /** Mesh belongs to a room (lighting + security camera render lists). */
  registerRoomMesh(roomId: string, mesh: AbstractMesh, kind: 'renderable' | 'light-only'): void;
}

export class ObjectFactory {
  private readonly templates = new Map<string, Mesh>();

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    private readonly stage: StageDefinition,
    private readonly hooks: FactoryHooks,
  ) {}

  static supportedTypes(): PropType[] {
    return Object.keys(BUILDERS) as PropType[];
  }

  build(placement: PropPlacement, room: RoomDefinition): BuiltProp {
    const kit = new PropKit(this.scene, this.lib, placement.id);
    const ctx: PropBuildContext = {
      scene: this.scene,
      lib: this.lib,
      stage: this.stage,
      room,
      placement,
      template: (key, build) => {
        const cacheKey = `${room.id}:${key}`;
        let template = this.templates.get(cacheKey);
        if (!template) {
          template = build();
          template.isVisible = false;
          template.isPickable = false;
          template.setEnabled(true);
          this.hooks.registerRoomMesh(room.id, template, 'light-only');
          this.templates.set(cacheKey, template);
        }
        return template;
      },
    };
    BUILDERS[placement.type](ctx, kit);
    const built = kit.finish();

    const [x, y, z] = placement.position;
    built.root.position.set(x, y, z);
    built.root.rotation.y = ((placement.rotationY ?? 0) * Math.PI) / 180;
    if (placement.scale) built.root.scaling.setAll(placement.scale);

    const occluder = !NON_OCCLUDING.has(placement.type);
    for (const mesh of built.meshes) {
      mesh.isPickable = mesh.isPickable !== false;
      mesh.metadata = { kind: 'prop', id: placement.id, occluder };
      if (placement.cameraOnly) {
        mesh.layerMask = CAMERA_ONLY_LAYER;
        mesh.isPickable = false;
      }
      mesh.receiveShadows = true;
      this.hooks.registerRoomMesh(room.id, mesh, 'renderable');
    }
    for (const light of built.lights ?? []) light.includedOnlyMeshes = built.meshes.filter((m) => !m.isAnInstance);
    if (built.text && built.defaultText !== undefined) built.text.draw(built.defaultText);
    if (placement.hidden) built.root.setEnabled(false);
    return built;
  }

  dispose(): void {
    for (const t of this.templates.values()) t.dispose();
    this.templates.clear();
  }
}
