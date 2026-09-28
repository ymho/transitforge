#!/usr/bin/env bash
set -euo pipefail

usage() { echo 'Usage: OTP_IMAGE=docker.io/opentripplanner/opentripplanner@sha256:<digest> run-local.sh build|serve <graph-data-dir>' >&2; exit 2; }
[[ $# -eq 2 ]] || usage
[[ "$1" == build || "$1" == serve ]] || usage
[[ "${OTP_IMAGE:-}" == docker.io/opentripplanner/opentripplanner@sha256:* ]] || usage
command -v docker >/dev/null || { echo 'Docker is required' >&2; exit 2; }
graph_dir=$(realpath "$2")
[[ -d "$graph_dir" ]] || usage
shopt -s nullglob
if [[ "$1" == build ]]; then
  osm=("$graph_dir"/*.osm.pbf)
  gtfs=("$graph_dir"/*gtfs*.zip)
  [[ ${#osm[@]} -eq 1 && ${#gtfs[@]} -eq 1 ]] || { echo 'Exactly one OSM .osm.pbf and one *gtfs*.zip are required' >&2; exit 2; }
  (cd "$graph_dir" && sha256sum "${osm[0]}" "${gtfs[0]}" > input-sha256.txt)
  docker run --rm -e JAVA_TOOL_OPTIONS='-Xmx8g' -v "$graph_dir:/var/opentripplanner" "$OTP_IMAGE" --build --save
else
  [[ -f "$graph_dir/Graph.obj" || -f "$graph_dir/graph.obj" ]] || { echo 'Build the graph first' >&2; exit 2; }
  docker run --rm -p 127.0.0.1:8080:8080 -e JAVA_TOOL_OPTIONS='-Xmx8g' -v "$graph_dir:/var/opentripplanner:ro" "$OTP_IMAGE" --load --serve
fi
