export interface AirportRailAccess { airportCode: string; stationName: string }

const airportRailAccesses: Record<string, AirportRailAccess> = {
  KIX: { airportCode: "KIX", stationName: "関西空港" },
  ITM: { airportCode: "ITM", stationName: "大阪空港" },
  NRT: { airportCode: "NRT", stationName: "成田空港" },
  HND: { airportCode: "HND", stationName: "羽田空港第1・第2ターミナル" },
  NGO: { airportCode: "NGO", stationName: "中部国際空港" },
  FUK: { airportCode: "FUK", stationName: "福岡空港" },
};

export function airportRailAccess(airportCode: string): AirportRailAccess | undefined { return airportRailAccesses[airportCode.toUpperCase()]; }
