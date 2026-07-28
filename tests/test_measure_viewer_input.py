import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "measure_viewer_input.py"
SPEC = importlib.util.spec_from_file_location("measure_viewer_input", MODULE_PATH)
measure_viewer_input = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(measure_viewer_input)


class MeasureViewerInputTest(unittest.TestCase):
    def write_json(self, directory, name, value):
        path = Path(directory) / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def test_measures_scale_concurrency_and_integrity(self):
        catalog = {
            "schema_version": "train-path-catalog-v1",
            "paths": [
                {
                    "path_id": "path-a",
                    "coord_count": 2,
                    "route_coords": [[135.0, 34.0], [136.0, 35.0]],
                },
                {
                    "path_id": "path-b",
                    "coord_count": 2,
                    "route_coords": [[134.0, 36.0]],
                },
            ],
        }

        def stop(seq, time, meter):
            return {
                "seq": seq,
                "station_name": f"station-{seq}",
                "event": "発",
                "time": "00:00",
                "normalized_time": "24:00",
                "time_minutes": time,
                "route_meter": meter,
                "route_time_minutes": time,
            }

        trains = {
            "schema_version": "train-index-v1",
            "path_catalog": "path_catalog.json",
            "trains": [
                {"service_uid": "a", "path_id": "path-a", "stops": [stop(0, 1430, 0), stop(1, 1500, 100)]},
                {"service_uid": "b", "path_id": "path-a", "stops": [stop(0, 1500, 0), stop(1, 1510, 100)]},
                {"service_uid": "c", "path_id": "missing", "stops": [stop(0, 1490, 0), stop(1, 1520, 100)]},
                {"service_uid": "d", "stops": [{"seq": 0}]},
            ],
        }

        with tempfile.TemporaryDirectory() as directory:
            train_path = self.write_json(directory, "train_index.json", trains)
            catalog_path = self.write_json(directory, "path_catalog.json", catalog)
            report = measure_viewer_input.measure(train_path, catalog_path)

        self.assertEqual(report["scale"]["train_count"], 4)
        self.assertEqual(report["scale"]["path_count"], 2)
        self.assertEqual(report["scale"]["total_coordinate_count"], 3)
        self.assertEqual(report["scale"]["maximum_coordinates_per_path"], 2)
        self.assertEqual(report["scale"]["geographic_bbox"], [134.0, 34.0, 136.0, 36.0])
        self.assertEqual(report["scale"]["maximum_concurrent_scheduled_trains"], 3)
        self.assertEqual(report["scale"]["maximum_concurrent_drawable_trains"], 2)
        self.assertEqual(report["integrity"]["trains_without_path_id"], 1)
        self.assertEqual(report["integrity"]["trains_with_missing_path"], 1)
        self.assertEqual(report["integrity"]["stops_missing_required_fields"], 1)
        self.assertEqual(report["integrity"]["paths_with_coord_count_mismatch"], 1)

    def test_counts_duplicate_ids_and_reversed_positions(self):
        catalog = {
            "schema_version": "wrong",
            "paths": [
                {"path_id": "same", "coord_count": 1, "route_coords": [[0, 0]]},
                {"path_id": "same", "coord_count": 1, "route_coords": [["bad", 0]]},
            ],
        }
        stops = [
            {field: 10 for field in measure_viewer_input.STOP_FIELDS},
            {field: 5 for field in measure_viewer_input.STOP_FIELDS},
        ]
        trains = {
            "schema_version": "train-index-v1",
            "trains": [
                {"service_uid": "same", "path_id": "same", "stops": stops},
                {"service_uid": "same", "path_id": "same", "stops": stops},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            train_path = self.write_json(directory, "train_index.json", trains)
            catalog_path = self.write_json(directory, "path_catalog.json", catalog)
            report = measure_viewer_input.measure(train_path, catalog_path)

        self.assertFalse(report["integrity"]["path_schema_version_valid"])
        self.assertEqual(report["integrity"]["duplicate_service_uids"], 1)
        self.assertEqual(report["integrity"]["duplicate_path_ids"], 1)
        self.assertEqual(report["integrity"]["invalid_coordinates"], 1)
        self.assertEqual(report["integrity"]["trains_with_reversed_route_time"], 2)
        self.assertEqual(report["integrity"]["trains_with_reversed_route_meter"], 2)


if __name__ == "__main__":
    unittest.main()
