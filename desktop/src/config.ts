/** App identity and the complete list of external services the app talks to. */

export const APP_NAME = 'ОИР RRL Planner';
export const APP_SHORT = 'RRL Planner';
export const ORG_SHORT = 'ОИР';
export const ORG_FULL = 'Отдел инфраструктурных решений';
declare const __APP_VERSION__: string;
/** From package.json (set to 1.0.<build number> by the build workflow). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0';

declare const __BUILD_ID__: string;
/** Unique id of this build (set by vite.config.ts). */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
declare const __BUILD_NUM__: string;
/** Sequential build number (GitHub Actions run number); 0 for a local build. */
export const BUILD_NUMBER: number = typeof __BUILD_NUM__ === 'string' ? Number(__BUILD_NUM__) || 0 : 0;
/**
 * Public GitHub repository whose Releases carry the installers. «Обновить приложение» asks the
 * public GitHub API for the latest release; nothing else is sent and no account is needed.
 */
export const UPDATE_REPO = 'ShestakovNP/oir-rrl-planner_ver.1';
/**
 * Test phase: every new build starts with an empty project list. Projects of the previous build
 * are saved to a backup JSON next to the database first. The equipment library is kept.
 * Set to false before handing the program out for real work — then updates keep the projects.
 */
export const RESET_PROJECTS_ON_NEW_BUILD = true;

/** Sent with every request: OSM, Nominatim and OpenTopoData policies ask apps to identify themselves. */
export const USER_AGENT = `OIR-RRL-Planner/${APP_VERSION} (desktop; infrastructure planning tool)`;

export const MAPTILER_KEY: string = (import.meta.env?.VITE_MAPTILER_KEY as string | undefined)?.trim() || '';

export interface TileProvider {
  id: string;
  name: string;
  url: string;
  subdomains?: string;
  maxZoom: number;
  attribution: string;
  /** Some providers forbid bulk caching; we still cache only tiles the user has viewed. */
  dark?: boolean;
}

const OSM_ATTR = '© участники <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const TILE_PROVIDERS: TileProvider[] = [
  { id: 'osm', name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: OSM_ATTR },
  { id: '2gis', name: '2ГИС', url: 'https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1.5&ts=online_sd', subdomains: '0123', maxZoom: 18, attribution: '© <a href="https://2gis.ru">2ГИС</a>' },
  { id: 'topo', name: 'Рельеф (OpenTopoMap)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 17, attribution: `${OSM_ATTR}, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)` },
  { id: 'sat', name: 'Спутник (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics' },
  { id: 'light', name: 'Светлая (CARTO)', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', subdomains: 'abcd', maxZoom: 20, attribution: `${OSM_ATTR} © <a href="https://carto.com/attributions">CARTO</a>` },
  { id: 'dark', name: 'Тёмная (CARTO)', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', subdomains: 'abcd', maxZoom: 20, attribution: `${OSM_ATTR} © <a href="https://carto.com/attributions">CARTO</a>`, dark: true },
  ...(MAPTILER_KEY
    ? [
        { id: 'mt-streets', name: 'MapTiler: улицы', url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`, maxZoom: 20, attribution: '© MapTiler © OpenStreetMap' },
        { id: 'mt-sat', name: 'MapTiler: спутник', url: `https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`, maxZoom: 20, attribution: '© MapTiler © OpenStreetMap' }
      ]
    : [])
];

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const ELEVATION_URL = 'https://api.opentopodata.org/v1/srtm30m';
/** Buildings and forests along the path (OpenStreetMap data via Overpass API, no key). */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Tile cache limits (IndexedDB). */
export const TILE_CACHE_MAX = 25000;
export const TILE_CACHE_FRESH_DAYS = 30;
