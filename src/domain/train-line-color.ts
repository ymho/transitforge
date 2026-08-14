import type {
  StationCoordinate,
  StationLineCatalog,
  StationLineCatalogLine,
} from "../data/station-line-catalog";
import type { Train } from "../data/train-index";

export interface TrainLineColor {
  color: string;
  lineName: string;
}

interface IndexedLine {
  operator: string;
  line: string;
  stations: Map<string, StationCoordinate>;
}

const neutralLine: TrainLineColor = {
  color: "#a8aaad",
  lineName: "路線未判定",
};

const shinkansenLine: TrainLineColor = {
  color: "#2b4598",
  lineName: "新幹線",
};

const regionalLineColors = new Map<string, TrainLineColor>([
  ["東海道線", line("#007cc3", "琵琶湖線・JR京都線・JR神戸線")],
  ["北陸線", line("#007cc3", "北陸線")],
  ["湖西線", line("#00b3e6", "湖西線")],
  ["草津線", line("#69b150", "草津線")],
  ["奈良線", line("#bc7e38", "奈良線")],
  ["福知山線", line("#fec21d", "JR宝塚線・福知山線")],
  ["JR東西線", line("#ee428b", "JR東西線")],
  ["片町線", line("#ee428b", "学研都市線")],
  ["加古川線", line("#00b18f", "加古川線")],
  ["播但線", line("#b1305a", "播但線")],
  ["姫新線", line("#f04f33", "姫新線")],
  ["舞鶴線", line("#f99e26", "舞鶴線")],
  ["大阪環状線", line("#ef3f53", "大阪環状線")],
  ["桜島線", line("#2b4598", "JRゆめ咲線")],
  ["おおさか東線", line("#4b7996", "おおさか東線")],
  ["阪和線", line("#f99e26", "阪和線")],
  ["関西空港線", line("#007cc3", "関西空港線")],
  ["和歌山線", line("#f6a4ba", "和歌山線")],
  ["桜井線", line("#d02c39", "万葉まほろば線")],
  ["紀勢線", line("#00b1c3", "きのくに線")],
  ["山口線", line("#7e733d", "山口線")],
  ["美祢線", line("#d70080", "美祢線")],
  ["小野田線", line("#695faa", "小野田線")],
  ["宇部線", line("#b02857", "宇部線")],
  ["因美線", line("#b27b46", "因美線")],
  ["境線", line("#296cab", "境線")],
  ["木次線", line("#f5b63e", "木次線")],
  ["伯備線", line("#569358", "伯備線")],
  ["福塩線", line("#49479d", "福塩線")],
  ["吉備線", line("#f6a4b5", "桃太郎線")],
  ["津山線", line("#febc18", "津山線")],
  ["宇野線", line("#79cdcd", "宇野みなと線")],
  ["本四備讃線", line("#007cc2", "瀬戸大橋線")],
  ["呉線", line("#939598", "呉線")],
  ["芸備線", line("#939598", "芸備線")],
]);

export class TrainLineColorIndex {
  private readonly linesByStation = new Map<string, IndexedLine[]>();

  constructor(catalog: StationLineCatalog) {
    for (const catalogLine of catalog.lines) {
      const indexedLine = indexLine(catalogLine);
      for (const stationName of indexedLine.stations.keys()) {
        const lines = this.linesByStation.get(stationName) ?? [];
        lines.push(indexedLine);
        this.linesByStation.set(stationName, lines);
      }
    }
  }

  colorFor(train: Pick<Train, "destination_station" | "service_type" | "stops">): TrainLineColor {
    const stationNames = distinctStationNames(train);
    const destinationName = normalizeStationName(train.destination_station);
    const destinationLines = this.linesByStation.get(destinationName) ?? [];

    if (train.service_type.includes("新幹線")) {
      return shinkansenLine;
    }

    const rankedLines = destinationLines
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, stationNames),
      }))
      .sort((left, right) => right.score - left.score);
    const best = rankedLines[0];

    if (!best || (rankedLines[1] && rankedLines[1].score === best.score)) {
      return neutralLine;
    }

    const approachCoordinate = nearestPriorCoordinate(best.candidate, stationNames, destinationName);
    const destinationCoordinate = best.candidate.stations.get(destinationName);
    return colorForLine(best.candidate, destinationCoordinate, approachCoordinate);
  }
}

function scoreCandidate(candidate: IndexedLine, stationNames: string[]): number {
  let score = 0;

  for (let index = stationNames.length - 1; index >= 0; index -= 1) {
    if (!candidate.stations.has(stationNames[index])) {
      continue;
    }
    const distanceFromEnd = stationNames.length - 1 - index;
    score += distanceFromEnd === 0 ? 1 : Math.max(2, 100 - distanceFromEnd);
  }

  return score;
}

function nearestPriorCoordinate(
  candidate: IndexedLine,
  stationNames: string[],
  destinationName: string,
): StationCoordinate | undefined {
  for (let index = stationNames.length - 1; index >= 0; index -= 1) {
    const stationName = stationNames[index];
    if (stationName !== destinationName) {
      const coordinate = candidate.stations.get(stationName);
      if (coordinate) {
        return coordinate;
      }
    }
  }
  return undefined;
}

function colorForLine(
  candidate: IndexedLine,
  destinationCoordinate?: StationCoordinate,
  approachCoordinate?: StationCoordinate,
): TrainLineColor {
  if (candidate.line.includes("新幹線")) {
    return shinkansenLine;
  }

  const routeLongitude = meanLongitude(destinationCoordinate, approachCoordinate);
  if (candidate.line === "山陽線") {
    return sanyoLineColor(routeLongitude);
  }
  if (candidate.line === "山陰線") {
    return saninLineColor(routeLongitude);
  }
  if (candidate.line === "関西線") {
    return routeLongitude !== undefined && routeLongitude >= 135.87
      ? line("#564c9e", "関西線")
      : line("#00af76", "大和路線");
  }
  if (candidate.line === "赤穂線") {
    return routeLongitude !== undefined && routeLongitude >= 134.39
      ? line("#007cc3", "赤穂線（近畿エリア）")
      : line("#f16469", "赤穂線（岡山エリア）");
  }

  return regionalLineColors.get(candidate.line) ?? neutralLine;
}

function sanyoLineColor(longitude?: number): TrainLineColor {
  if (longitude === undefined) {
    return neutralLine;
  }
  if (longitude >= 134.35) {
    return line("#007cc3", "JR神戸線・山陽線（近畿エリア）");
  }
  if (longitude >= 133.92) {
    return line("#b0d235", "山陽線（姫路・岡山間）");
  }
  if (longitude >= 133.36) {
    return line("#f79137", "山陽線（岡山・福山間）");
  }
  if (longitude >= 132.2) {
    return line("#00aeef", "山陽線（福山・広島間）");
  }
  return line("#006bb6", "山陽線（山口エリア）");
}

function saninLineColor(longitude?: number): TrainLineColor {
  if (longitude === undefined) {
    return neutralLine;
  }
  if (longitude >= 135.45) {
    return line("#7887c3", "嵯峨野線・山陰線");
  }
  if (longitude >= 132.75) {
    return line("#a6c858", "山陰線（鳥取・島根東部）");
  }
  return line("#e9663d", "山陰線（島根西部・山口）");
}

function distinctStationNames(
  train: Pick<Train, "destination_station" | "stops">,
): string[] {
  const stationNames: string[] = [];
  for (const stop of train.stops) {
    if (!stop.station_name) {
      continue;
    }
    const stationName = normalizeStationName(stop.station_name);
    if (stationNames.at(-1) !== stationName) {
      stationNames.push(stationName);
    }
  }

  const destinationName = normalizeStationName(train.destination_station);
  if (stationNames.at(-1) !== destinationName) {
    stationNames.push(destinationName);
  }
  return stationNames;
}

function indexLine(catalogLine: StationLineCatalogLine): IndexedLine {
  return {
    operator: catalogLine.operator,
    line: catalogLine.line,
    stations: new Map(
      catalogLine.stations.map(({ name, coordinate }) => [
        normalizeStationName(name),
        coordinate,
      ]),
    ),
  };
}

function normalizeStationName(stationName: string): string {
  return stationName.normalize("NFKC").trim().replaceAll("ヶ", "ケ");
}

function meanLongitude(
  first?: StationCoordinate,
  second?: StationCoordinate,
): number | undefined {
  if (first && second) {
    return (first[0] + second[0]) / 2;
  }
  return first?.[0] ?? second?.[0];
}

function line(color: string, lineName: string): TrainLineColor {
  return { color, lineName };
}
