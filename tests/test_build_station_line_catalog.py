import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "build_station_line_catalog.py"
SPEC = importlib.util.spec_from_file_location("build_station_line_catalog", MODULE_PATH)
build_station_line_catalog = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(build_station_line_catalog)


class BuildStationLineCatalogTest(unittest.TestCase):
    def test_filters_aliases_and_groups_station_memberships(self):
        source = {
            "type": "FeatureCollection",
            "features": [
                self.feature("WILLER　TRAINS", "宮津線", "豊岡", [[134.8, 35.5], [134.9, 35.6]]),
                self.feature("対象外事業者", "対象外", "駅", [[1, 2], [3, 4]]),
                self.feature("ＩＲいしかわ鉄道", "IRいしかわ鉄道線", "金沢", [[136.6, 36.5]]),
                self.feature("西日本旅客鉄道", "関西線", "ＪＲ難波", [[135.5, 34.6]]),
                self.feature("対象外事業者", "対象外", "駅", [[1, 2]]),
            ],
        }

        catalog = build_station_line_catalog.build_catalog(source, "stations.geojson")

        self.assertEqual(catalog["schema_version"], "station-line-catalog-v1")
        self.assertEqual(
            catalog["lines"],
            [
                {
                    "operator": "IRいしかわ鉄道",
                    "line": "IRいしかわ鉄道線",
                    "stations": [{"name": "金沢", "coordinate": [136.6, 36.5]}],
                },
                {
                    "operator": "京都丹後鉄道",
                    "line": "宮津線",
                    "stations": [{"name": "豊岡", "coordinate": [134.85, 35.55]}],
                },
                {
                    "operator": "西日本旅客鉄道",
                    "line": "関西線",
                    "stations": [{"name": "JR難波", "coordinate": [135.5, 34.6]}],
                },
            ],
        )

    @staticmethod
    def feature(operator, line, station, coordinates):
        return {
            "type": "Feature",
            "properties": {
                "N02_003": line,
                "N02_004": operator,
                "N02_005": station,
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        }


if __name__ == "__main__":
    unittest.main()
