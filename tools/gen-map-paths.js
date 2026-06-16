#!/usr/bin/env node
// tools/gen-map-paths.js — BUILD-TIME ONLY. Precompute US state SVG paths + centroids from
// us-atlas, projected to a 960x600 canvas, and commit the result to assets/us-states-paths.json.
// The cloud renderer (lib/newsImage.js) reads only that JSON — no d3/topojson at runtime.
//   node tools/gen-map-paths.js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { feature } from "topojson-client";
import { geoPath, geoAlbersUsa, geoIdentity } from "d3-geo";

const VIEW_W = 960, VIEW_H = 600;
const FIPS = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"], "05": ["AR", "Arkansas"],
  "06": ["CA", "California"], "08": ["CO", "Colorado"], "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"],
  "11": ["DC", "District of Columbia"], "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"], "19": ["IA", "Iowa"],
  "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"], "22": ["LA", "Louisiana"], "23": ["ME", "Maine"],
  "24": ["MD", "Maryland"], "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"], "31": ["NE", "Nebraska"],
  "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"], "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"],
  "36": ["NY", "New York"], "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"], "44": ["RI", "Rhode Island"],
  "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"], "47": ["TN", "Tennessee"], "48": ["TX", "Texas"],
  "49": ["UT", "Utah"], "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

const topo = JSON.parse(await readFile("node_modules/us-atlas/states-10m.json", "utf8"));
const fc = feature(topo, topo.objects.states);

// us-atlas may ship geographic (lon/lat) OR pre-projected planar coords — detect via bbox.
const geographic = topo.bbox && topo.bbox[0] < -50;
const proj = geographic ? geoAlbersUsa() : geoIdentity();
proj.fitSize([VIEW_W, VIEW_H], fc);
const path = geoPath(proj);
console.log(`projection: ${geographic ? "geoAlbersUsa (geographic input)" : "geoIdentity (pre-projected input)"}`);

// Major US cities (lon, lat) projected into the SAME map space, so the renderer can drop labelled dots.
const CITIES = {
  "New York": [-74.006, 40.713], "Los Angeles": [-118.243, 34.052], "Chicago": [-87.630, 41.878],
  "Houston": [-95.369, 29.760], "Phoenix": [-112.074, 33.448], "Philadelphia": [-75.165, 39.952],
  "San Antonio": [-98.494, 29.424], "San Diego": [-117.161, 32.716], "Dallas": [-96.797, 32.777],
  "Fort Worth": [-97.331, 32.756], "Austin": [-97.743, 30.267], "San Jose": [-121.886, 37.339],
  "Jacksonville": [-81.656, 30.332], "Columbus": [-82.999, 39.961], "Charlotte": [-80.843, 35.227],
  "Indianapolis": [-86.158, 39.768], "San Francisco": [-122.419, 37.775], "Seattle": [-122.332, 47.606],
  "Denver": [-104.991, 39.739], "Washington": [-77.037, 38.907], "Boston": [-71.058, 42.360],
  "Nashville": [-86.781, 36.163], "Atlanta": [-84.388, 33.749], "Miami": [-80.192, 25.762],
  "Tampa": [-82.458, 27.948], "Orlando": [-81.379, 28.538], "New Orleans": [-90.071, 29.951],
  "Minneapolis": [-93.265, 44.978], "Kansas City": [-94.578, 39.099], "St. Louis": [-90.199, 38.627],
  "Oklahoma City": [-97.516, 35.467], "Plano": [-96.698, 33.019], "Arlington": [-97.108, 32.735],
  "Waco": [-97.146, 31.549], "Las Vegas": [-115.139, 36.169], "Portland": [-122.676, 45.523],
  "Detroit": [-83.045, 42.331], "Salt Lake City": [-111.891, 40.760], "Sacramento": [-121.494, 38.581],
  "Memphis": [-90.049, 35.149], "Louisville": [-85.758, 38.252], "Milwaukee": [-87.906, 43.039],
  "Albuquerque": [-106.650, 35.084], "Tucson": [-110.974, 32.222], "Birmingham": [-86.802, 33.519],
  "Raleigh": [-78.638, 35.780], "Richmond": [-77.436, 37.541], "Buffalo": [-78.878, 42.886],
  "Cleveland": [-81.694, 41.499], "Cincinnati": [-84.512, 39.103], "Pittsburgh": [-79.996, 40.441],
  "Omaha": [-95.996, 41.257], "Boise": [-116.202, 43.615], "Little Rock": [-92.289, 34.746],
  "Jackson": [-90.185, 32.299], "Charleston": [-79.931, 32.785],
};
const cityOut = {};
for (const [name, lonlat] of Object.entries(CITIES)) {
  const p = proj(lonlat);
  if (p) cityOut[name] = { x: Math.round(p[0]), y: Math.round(p[1]) };
}

const out = { _viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, _w: VIEW_W, _h: VIEW_H, _cities: cityOut };
let n = 0;
for (const f of fc.features) {
  const meta = FIPS[String(f.id).padStart(2, "0")];
  if (!meta) continue;
  const d = path(f);
  if (!d) continue; // AK/HI fall outside geoIdentity fit; albersUsa keeps them as insets
  const [cx, cy] = path.centroid(f);
  const [[x0, y0], [x1, y1]] = path.bounds(f);
  const [usps, name] = meta;
  out[usps] = { d, cx: Math.round(cx), cy: Math.round(cy), name, bbox: [x0, y0, x1, y1].map(Math.round) };
  n++;
}
await mkdir("assets", { recursive: true });
await writeFile("assets/us-states-paths.json", JSON.stringify(out));
console.log(`wrote assets/us-states-paths.json — ${n} states, viewBox ${out._viewBox}`);
