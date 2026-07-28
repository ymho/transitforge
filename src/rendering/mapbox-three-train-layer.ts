import mapboxgl from "mapbox-gl";
import * as THREE from "three";

import { coupledTrainLayouts } from "../domain/coupled-train-layout";
import type { TrainPosition } from "../domain/train-position";
import { trainVisualScaleForZoom } from "../domain/train-visual-scale";

const maximumTrainInstances = 1_000;
const vehicleLengthMeters = 12;
const vehicleWidthMeters = 5;
const vehicleHeightMeters = 5.6;

export class MapboxThreeTrainLayer implements mapboxgl.CustomLayerInterface {
  readonly id = "trains-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: mapboxgl.Map;
  private camera?: THREE.Camera;
  private scene?: THREE.Scene;
  private renderer?: THREE.WebGLRenderer;
  private trains?: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private readonly instanceTransform = new THREE.Object3D();
  private readonly instanceColor = new THREE.Color();
  // MapboxのMercator座標はY軸が南向きであるため、Three.jsのモデル座標との境界で
  // 一度だけ反転する。車両ごとの行列には負スケールを入れない。
  private readonly mapboxToThreeCoordinates = new THREE.Matrix4().makeScale(1, -1, 1);
  private readonly worldOrigin = new THREE.Vector3();
  private readonly worldOriginTranslation = new THREE.Matrix4();
  private readonly displayedBearingByServiceUid = new Map<string, number>();
  private positions: TrainPosition[] = [];

  constructor(private readonly colorsByServiceUid: ReadonlyMap<string, string>) {}

  onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 1.8);
    const directional = new THREE.DirectionalLight(0xffe2a5, 2.4);
    directional.position.set(0, -1, 1).normalize();
    this.scene.add(ambient, directional);

    const geometry = new THREE.BoxGeometry(
      vehicleLengthMeters,
      vehicleWidthMeters,
      vehicleHeightMeters,
    );
    const material = new THREE.MeshLambertMaterial({
      // インスタンスカラーは基本色と乗算されるため、白を使ってラインカラーを保つ。
      color: 0xffffff,
    });
    this.trains = new THREE.InstancedMesh(geometry, material, maximumTrainInstances);
    // インスタンス行列は常に正のスケールだけを使用する。
    this.trains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trains.frustumCulled = false;
    this.scene.add(this.trains);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.updateWorldOrigin();

    // 列車を常に地図表示中心に近いローカル座標で描く。世界Mercator座標のまま小さな
    // 直方体を扱うと、高ズーム時にGPUの浮動小数点精度が不足し、輪郭が揺れるため。
    map.on("move", this.recenterWorldOrigin);
  }

  setPositions(positions: TrainPosition[]): void {
    this.positions = positions;
    this.updateInstances();
  }

  private updateInstances(): void {
    if (!this.trains || !this.map) {
      return;
    }

    const visiblePositions = this.positions.slice(0, maximumTrainInstances);
    const visibleLayouts = coupledTrainLayouts(visiblePositions);
    const visibleBearingTrackingKeys = new Set(
      visibleLayouts.map(({ bearingTrackingKey }) => bearingTrackingKey),
    );
    const vehicleVisualScale = trainVisualScaleForZoom(this.map.getZoom());

    for (const [index, layout] of visibleLayouts.entries()) {
      const { position } = layout;
      const mercator = mapboxgl.MercatorCoordinate.fromLngLat(
        layout.renderCoordinate,
        0,
      );
      const metersToMercatorUnits = mercator.meterInMercatorCoordinateUnits();
      const bearingRadians = this.smoothBearing(
        layout.bearingTrackingKey,
        layout.renderBearingRadians,
      );
      const longitudinalOffset =
        layout.longitudinalOffsetInVehicleLengths *
        vehicleLengthMeters *
        vehicleVisualScale *
        metersToMercatorUnits;
      const overlapLongitudinalOffset =
        layout.overlapOffsetMeters.longitudinal *
        vehicleVisualScale *
        metersToMercatorUnits;
      const overlapLateralOffset =
        layout.overlapOffsetMeters.lateral *
        vehicleVisualScale *
        metersToMercatorUnits;
      this.instanceTransform.position.set(
        mercator.x -
          this.worldOrigin.x +
          Math.sin(bearingRadians) *
            (longitudinalOffset + overlapLongitudinalOffset) +
          Math.cos(bearingRadians) * overlapLateralOffset,
        -(mercator.y - this.worldOrigin.y) +
          Math.cos(bearingRadians) *
            (longitudinalOffset + overlapLongitudinalOffset) -
          Math.sin(bearingRadians) * overlapLateralOffset,
        mercator.z +
          metersToMercatorUnits *
            vehicleVisualScale *
            (vehicleHeightMeters / 2 + layout.overlapOffsetMeters.vertical),
      );
      // BoxGeometry の長手方向はローカルX軸。座標境界のY軸反転を考慮して、
      // 経路接線の方位（北=0、東=PI/2）にそのX軸を一致させる。
      this.instanceTransform.rotation.set(0, 0, Math.PI / 2 - bearingRadians);
      this.instanceTransform.scale.set(
        metersToMercatorUnits * vehicleVisualScale * layout.lengthScale,
        metersToMercatorUnits * vehicleVisualScale,
        metersToMercatorUnits * vehicleVisualScale,
      );
      this.instanceTransform.updateMatrix();
      this.trains.setMatrixAt(index, this.instanceTransform.matrix);
      this.trains.setColorAt(index, this.colorFor(position.serviceUid));
    }

    for (const bearingTrackingKey of this.displayedBearingByServiceUid.keys()) {
      if (!visibleBearingTrackingKeys.has(bearingTrackingKey)) {
        this.displayedBearingByServiceUid.delete(bearingTrackingKey);
      }
    }

    this.trains.count = visibleLayouts.length;
    this.trains.instanceMatrix.needsUpdate = true;
    if (this.trains.instanceColor) {
      this.trains.instanceColor.needsUpdate = true;
    }
    this.map.triggerRepaint();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]): void {
    if (!this.camera || !this.scene || !this.renderer) {
      return;
    }

    // Mapboxが渡すカメラ行列に、ローカル原点への平行移動と座標系境界のY軸反転を合成する。
    // Mapboxの3D Custom Layerと同じ変換であり、地図と深度バッファを共有する。
    this.camera.projectionMatrix
      .fromArray(matrix)
      .multiply(this.worldOriginTranslation)
      .multiply(this.mapboxToThreeCoordinates);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.map?.off("move", this.recenterWorldOrigin);
    this.trains?.geometry.dispose();
    this.trains?.material.dispose();
    this.renderer?.dispose();
  }

  private colorFor(serviceUid: string): THREE.Color {
    return this.instanceColor.set(this.colorsByServiceUid.get(serviceUid) ?? "#a8aaad");
  }

  private smoothBearing(serviceUid: string, targetBearingRadians: number): number {
    const displayedBearing = this.displayedBearingByServiceUid.get(serviceUid);
    if (displayedBearing === undefined) {
      this.displayedBearingByServiceUid.set(serviceUid, targetBearingRadians);
      return targetBearingRadians;
    }

    const shortestDifference = Math.atan2(
      Math.sin(targetBearingRadians - displayedBearing),
      Math.cos(targetBearingRadians - displayedBearing),
    );
    const nextBearing = displayedBearing + shortestDifference * 0.28;
    this.displayedBearingByServiceUid.set(serviceUid, nextBearing);
    return nextBearing;
  }

  private readonly recenterWorldOrigin = (): void => {
    this.updateWorldOrigin();
    this.updateInstances();
  };

  private updateWorldOrigin(): void {
    if (!this.map) {
      return;
    }

    const center = mapboxgl.MercatorCoordinate.fromLngLat(this.map.getCenter(), 0);
    this.worldOrigin.set(center.x, center.y, 0);
    this.worldOriginTranslation.makeTranslation(center.x, center.y, 0);
  }
}
