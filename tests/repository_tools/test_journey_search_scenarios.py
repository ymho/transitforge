from __future__ import annotations

import unittest

from tools.run_journey_search_scenarios import (
    assert_scenario,
    load_scenarios,
    run_scenario,
)


class JourneySearchScenarioTest(unittest.TestCase):
    def test_all_scenarios(self) -> None:
        scenarios = load_scenarios()
        self.assertGreaterEqual(len(scenarios), 10)
        for scenario in scenarios:
            with self.subTest(id=scenario["id"], name=scenario["name"]):
                assert_scenario(scenario, run_scenario(scenario))


if __name__ == "__main__":
    unittest.main()
