import mapboxgl from "mapbox-gl";
import * as THREE from "three";

import { congestionBarColor, congestionBarHeightMeters } from "./congestion-bar";
import type { Coordinate } from "@raiquora/train/path";
import { coupledTrainLayouts } from "../../../domain/coupled-train-layout";
import {
  destinationArcHeightMeters,
  destinationArcVertex,
} from "../../../domain/destination-arc-geometry";
import type { TrainPosition } from "../../../domain/train-position";
import type { TrainFormationLink } from "../../../domain/train-formation-link";
import { trainVisualScaleForZoom } from "../../../domain/train-visual-scale";
import { weatherHazeMixAtViewportPoint } from "../../../domain/weather-haze";

const maximumTrainInstances = 1_000;
const vehicleLengthMeters = 12;
const vehicleWidthMeters = 5;
const vehicleHeightMeters = 5.6;
const congestionBarWidthMeters = 3.2;
const congestionBarHitWidthMeters = 8;
const destinationArcSegments = 24;
const destinationArcVertexCount =
  maximumTrainInstances * destinationArcSegments * 2;
const cloudyAtmosphereColor = new THREE.Color("#c8d0d5");
const delayHaloColor = "#f59e0b";
const destinationChangeHaloColor = "#ef3340";
const delayHaloRadiusMeters = 10;
const delayHaloOpacity = 0.26;
const focusRingColor = "#4264fb";
const focusRingInnerRadiusMeters = 8;
const focusRingOuterRadiusMeters = 12;
const focusRingGroundOffsetMeters = 0.15;
const focusRingOpacity = 0.55;

export class MapboxThreeTrainLayer implements mapboxgl.CustomLayerInterface {
  readonly id = "trains-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: mapboxgl.Map;
  private camera?: THREE.Camera;
  private scene?: THREE.Scene;
  private renderer?: THREE.WebGLRenderer;
  private trains?: THREE.InstancedMesh<
    THREE.BoxGeometry,
    THREE.MeshBasicMaterial
  >;
  private delayHalos?: THREE.InstancedMesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >;
  private focusRing?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private congestionBars?: THREE.InstancedMesh<
    THREE.BoxGeometry,
    THREE.MeshBasicMaterial
  >;
  private congestionBarHitTargets?: THREE.InstancedMesh<
    THREE.BoxGeometry,
    THREE.MeshBasicMaterial
  >;
  private destinationArcs?: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >;
  private readonly instanceTransform = new THREE.Object3D();
  private readonly instanceColor = new THREE.Color();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  // MapboxのMercator座標はY軸が南向きであるため、Three.jsのモデル座標との境界で
  // 一度だけ反転する。車両ごとの行列には負スケールを入れない。
  private readonly mapboxToThreeCoordinates = new THREE.Matrix4().makeScale(1, -1, 1);
  private readonly worldOrigin = new THREE.Vector3();
  private readonly worldOriginTranslation = new THREE.Matrix4();
  private readonly displayedBearingByServiceUid = new Map<string, number>();
  private positions: TrainPosition[] = [];
  private focusedServiceUid?: string;
  private congestionByTrainNumber: ReadonlyMap<string, number> = new Map();
  private delayByTrainNumber: ReadonlyMap<string, number> = new Map();
  private destinationChangedServiceUids: ReadonlySet<string> = new Set();
  private congestionBarServiceUids: string[] = [];
  private congestionVisible = true;
  private destinationArcsVisible = false;
  private cloudyAtmosphereEnabled = false;

  constructor(
    private readonly colorsByServiceUid: ReadonlyMap<string, string>,
    private destinationCoordinatesByServiceUid: ReadonlyMap<
      string,
      Coordinate
    >,
    private readonly formationLinks: ReadonlyMap<string, TrainFormationLink>,
  ) {}

  onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    const geometry = new THREE.BoxGeometry(
      vehicleLengthMeters,
      vehicleWidthMeters,
      vehicleHeightMeters,
    );
    const material = new THREE.MeshBasicMaterial({
      // インスタンスカラーは基本色と乗算されるため、白を使って路線色を保つ。
      // UIと同じく透過だけでガラス感を作り、地図照明で路線色が暗転しないようにする。
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
      depthWrite: true,
      toneMapped: false,
    });
    this.trains = new THREE.InstancedMesh(geometry, material, maximumTrainInstances);
    // インスタンス行列は常に正のスケールだけを使用する。
    this.trains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trains.frustumCulled = false;
    this.scene.add(this.trains);

    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(
        focusRingInnerRadiusMeters,
        focusRingOuterRadiusMeters,
        32,
      ),
      new THREE.MeshBasicMaterial({
        color: focusRingColor,
        transparent: true,
        opacity: focusRingOpacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.focusRing.visible = false;
    this.focusRing.renderOrder = 3;
    this.scene.add(this.focusRing);
    this.delayHalos = new THREE.InstancedMesh(
      new THREE.SphereGeometry(delayHaloRadiusMeters, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: delayHaloOpacity,
        depthWrite: false,
      }),
      maximumTrainInstances,
    );
    this.delayHalos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.delayHalos.frustumCulled = false;
    this.delayHalos.count = 0;
    this.delayHalos.renderOrder = 2;
    this.scene.add(this.delayHalos);

    this.congestionBars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(
        congestionBarWidthMeters,
        congestionBarWidthMeters,
        1,
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.68,
      }),
      maximumTrainInstances,
    );
    this.congestionBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.congestionBars.frustumCulled = false;
    this.congestionBars.count = 0;
    this.scene.add(this.congestionBars);

    // 描画する棒は細いため、レイキャスト専用の広い非表示領域を別に持つ。
    this.congestionBarHitTargets = new THREE.InstancedMesh(
      new THREE.BoxGeometry(
        congestionBarHitWidthMeters,
        congestionBarHitWidthMeters,
        1,
      ),
      new THREE.MeshBasicMaterial(),
      maximumTrainInstances,
    );
    this.congestionBarHitTargets.instanceMatrix.setUsage(
      THREE.DynamicDrawUsage,
    );
    this.congestionBarHitTargets.count = 0;

    const destinationArcGeometry = new THREE.BufferGeometry();
    destinationArcGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(destinationArcVertexCount * 3),
        3,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    destinationArcGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(
        new Float32Array(destinationArcVertexCount * 3),
        3,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    destinationArcGeometry.setDrawRange(0, 0);
    this.destinationArcs = new THREE.LineSegments(
      destinationArcGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    this.destinationArcs.frustumCulled = false;
    this.destinationArcs.visible = false;
    this.destinationArcs.renderOrder = 1;
    this.scene.add(this.destinationArcs);

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

  setFocusedServiceUid(serviceUid: string | undefined): void {
    this.focusedServiceUid = serviceUid;
    this.updateInstances();
  }

  setCongestionByTrainNumber(
    congestionByTrainNumber: ReadonlyMap<string, number>,
  ): void {
    this.congestionByTrainNumber = congestionByTrainNumber;
    this.updateInstances();
  }

  setDelayByTrainNumber(
    delayByTrainNumber: ReadonlyMap<string, number>,
  ): void {
    this.delayByTrainNumber = delayByTrainNumber;
    this.updateInstances();
  }

  setDestinationChanges(
    changedServiceUids: ReadonlySet<string>,
    destinationCoordinatesByServiceUid: ReadonlyMap<string, Coordinate>,
  ): void {
    this.destinationChangedServiceUids = changedServiceUids;
    this.destinationCoordinatesByServiceUid = destinationCoordinatesByServiceUid;
    this.updateInstances();
  }

  setCongestionVisible(visible: boolean): void {
    this.congestionVisible = visible;
    if (this.congestionBars) {
      this.congestionBars.visible = visible;
    }
    this.map?.triggerRepaint();
  }

  setDestinationArcsVisible(visible: boolean): void {
    this.destinationArcsVisible = visible;
    if (this.destinationArcs) {
      this.destinationArcs.visible = visible;
    }
    this.updateDestinationArcs();
    this.map?.triggerRepaint();
  }

  setCloudyAtmosphereEnabled(enabled: boolean): void {
    this.cloudyAtmosphereEnabled = enabled;
    this.updateInstances();
  }

  congestionBarServiceUidAt(point: { x: number; y: number }): string | undefined {
    if (
      !this.congestionVisible ||
      !this.map ||
      !this.camera ||
      !this.congestionBarHitTargets
    ) {
      return undefined;
    }

    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      return undefined;
    }

    this.pointer.set(
      (point.x / width) * 2 - 1,
      1 - (point.y / height) * 2,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersection = this.raycaster.intersectObject(
      this.congestionBarHitTargets,
      false,
    )[0];
    return intersection?.instanceId === undefined
      ? undefined
      : this.congestionBarServiceUids[intersection.instanceId];
  }

  private updateInstances(): void {
    if (
      !this.trains ||
      !this.delayHalos ||
      !this.congestionBars ||
      !this.congestionBarHitTargets ||
      !this.map
    ) {
      return;
    }

    const visiblePositions = this.positions.slice(0, maximumTrainInstances);
    const visibleLayouts = coupledTrainLayouts(
      visiblePositions,
      this.formationLinks,
    ).slice(0, maximumTrainInstances);
    const visibleBearingTrackingKeys = new Set(
      visibleLayouts.map(({ bearingTrackingKey }) => bearingTrackingKey),
    );
    const vehicleVisualScale = trainVisualScaleForZoom(this.map.getZoom());
    let congestionBarCount = 0;
    let delayHaloCount = 0;

    if (this.focusRing) {
      this.focusRing.visible = false;
    }

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
      const hazeMix = this.hazeMixFor(position.coordinate);
      this.trains.setColorAt(
        index,
        this.colorFor(position.serviceUid).lerp(cloudyAtmosphereColor, hazeMix),
      );
      if (this.focusRing && position.serviceUid === this.focusedServiceUid) {
        this.focusRing.position.copy(this.instanceTransform.position);
        this.focusRing.position.z =
          mercator.z +
          metersToMercatorUnits *
            vehicleVisualScale *
            focusRingGroundOffsetMeters;
        this.focusRing.scale.setScalar(
          metersToMercatorUnits * vehicleVisualScale,
        );
        this.focusRing.visible = true;
      }

      const delayMinutes = this.delayByTrainNumber.get(position.trainNo);
      const destinationChanged = this.destinationChangedServiceUids.has(
        position.serviceUid,
      );
      if (
        (delayMinutes !== undefined && delayMinutes > 0) ||
        destinationChanged
      ) {
        // 球形の半透明ハローは地図の向きにかかわらず円形に見え、
        // 列車本体のラインカラーを残したまま遅延を遠景でも判別できる。
        this.instanceTransform.rotation.set(0, 0, 0);
        this.instanceTransform.scale.setScalar(
          metersToMercatorUnits * vehicleVisualScale,
        );
        this.instanceTransform.updateMatrix();
        this.delayHalos.setMatrixAt(
          delayHaloCount,
          this.instanceTransform.matrix,
        );
        this.delayHalos.setColorAt(
          delayHaloCount,
          this.instanceColor
            .set(
              destinationChanged ? destinationChangeHaloColor : delayHaloColor,
            )
            .lerp(cloudyAtmosphereColor, hazeMix),
        );
        delayHaloCount += 1;
      }

      const congestion = this.congestionByTrainNumber.get(position.trainNo);
      if (congestion !== undefined) {
        const barHeightMeters = congestionBarHeightMeters(congestion);
        this.instanceTransform.position.z =
          mercator.z +
          metersToMercatorUnits *
            vehicleVisualScale *
            (vehicleHeightMeters +
              layout.overlapOffsetMeters.vertical +
              barHeightMeters / 2);
        this.instanceTransform.scale.set(
          metersToMercatorUnits * vehicleVisualScale,
          metersToMercatorUnits * vehicleVisualScale,
          metersToMercatorUnits * vehicleVisualScale * barHeightMeters,
        );
        this.instanceTransform.updateMatrix();
        this.congestionBars.setMatrixAt(
          congestionBarCount,
          this.instanceTransform.matrix,
        );
        this.congestionBarHitTargets.setMatrixAt(
          congestionBarCount,
          this.instanceTransform.matrix,
        );
        this.congestionBars.setColorAt(
          congestionBarCount,
          this.instanceColor
            .set(congestionBarColor(congestion))
            .lerp(cloudyAtmosphereColor, hazeMix),
        );
        this.congestionBarServiceUids[congestionBarCount] =
          position.serviceUid;
        congestionBarCount += 1;
      }
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
    this.delayHalos.count = delayHaloCount;
    this.delayHalos.instanceMatrix.needsUpdate = true;
    if (this.delayHalos.instanceColor) {
      this.delayHalos.instanceColor.needsUpdate = true;
    }
    this.congestionBars.count = congestionBarCount;
    this.congestionBarServiceUids.length = congestionBarCount;
    this.congestionBars.instanceMatrix.needsUpdate = true;
    if (this.congestionBars.instanceColor) {
      this.congestionBars.instanceColor.needsUpdate = true;
    }
    this.congestionBarHitTargets.count = congestionBarCount;
    this.congestionBarHitTargets.instanceMatrix.needsUpdate = true;
    // InstancedMeshのレイキャストは全インスタンスを包む境界球で早期判定する。
    // 行列を動的更新した後は明示的な再計算が必要。
    this.congestionBarHitTargets.computeBoundingSphere();
    this.updateDestinationArcs();
    this.map.triggerRepaint();
  }

  private updateDestinationArcs(): void {
    if (!this.destinationArcs || !this.map) {
      return;
    }

    const geometry = this.destinationArcs.geometry;
    if (!this.destinationArcsVisible) {
      geometry.setDrawRange(0, 0);
      return;
    }

    const positions = geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    let vertexIndex = 0;

    for (const position of this.positions.slice(0, maximumTrainInstances)) {
      const destination =
        this.destinationCoordinatesByServiceUid.get(position.serviceUid);
      if (!destination) {
        continue;
      }

      const start = mapboxgl.MercatorCoordinate.fromLngLat(
        position.coordinate,
        0,
      );
      const end = mapboxgl.MercatorCoordinate.fromLngLat(destination, 0);
      const metersToMercatorUnits = start.meterInMercatorCoordinateUnits();
      const distanceMeters =
        Math.hypot(end.x - start.x, end.y - start.y) /
        metersToMercatorUnits;
      const arcHeightMeters = destinationArcHeightMeters(distanceMeters);
      const color = this.colorFor(position.serviceUid);

      for (let segment = 0; segment < destinationArcSegments; segment += 1) {
        const startProgress = segment / destinationArcSegments;
        const endProgress = (segment + 1) / destinationArcSegments;
        vertexIndex = this.writeDestinationArcVertex(
          positions,
          colors,
          vertexIndex,
          start,
          end,
          startProgress,
          metersToMercatorUnits,
          arcHeightMeters,
          color,
        );
        vertexIndex = this.writeDestinationArcVertex(
          positions,
          colors,
          vertexIndex,
          start,
          end,
          endProgress,
          metersToMercatorUnits,
          arcHeightMeters,
          color,
        );
      }
    }

    geometry.setDrawRange(0, vertexIndex);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  private writeDestinationArcVertex(
    positions: THREE.BufferAttribute,
    colors: THREE.BufferAttribute,
    vertexIndex: number,
    start: mapboxgl.MercatorCoordinate,
    end: mapboxgl.MercatorCoordinate,
    progress: number,
    metersToMercatorUnits: number,
    arcHeightMeters: number,
    color: THREE.Color,
  ): number {
    const vertex = destinationArcVertex(
      start,
      end,
      progress,
      metersToMercatorUnits,
      arcHeightMeters,
      this.worldOrigin,
    );
    positions.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
    colors.setXYZ(vertexIndex, color.r, color.g, color.b);
    return vertexIndex + 1;
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
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.map?.off("move", this.recenterWorldOrigin);
    this.trains?.geometry.dispose();
    this.trains?.material.dispose();
    this.delayHalos?.geometry.dispose();
    this.delayHalos?.material.dispose();
    this.congestionBars?.geometry.dispose();
    this.congestionBars?.material.dispose();
    this.focusRing?.geometry.dispose();
    this.focusRing?.material.dispose();
    this.congestionBarHitTargets?.geometry.dispose();
    this.congestionBarHitTargets?.material.dispose();
    this.destinationArcs?.geometry.dispose();
    this.destinationArcs?.material.dispose();
    this.renderer?.dispose();
  }

  private colorFor(serviceUid: string): THREE.Color {
    return this.instanceColor.set(this.colorsByServiceUid.get(serviceUid) ?? "#a8aaad");
  }

  private hazeMixFor(coordinate: Coordinate): number {
    if (!this.cloudyAtmosphereEnabled || !this.map) {
      return 0;
    }

    const canvas = this.map.getCanvas();
    return weatherHazeMixAtViewportPoint(this.map.project(coordinate), {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    });
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
