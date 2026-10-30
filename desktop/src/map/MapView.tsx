/** The map: base layers, sites as markers, links as lines coloured by result. */
import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TILE_PROVIDERS } from '../config';
import { CachedTileLayer } from './CachedTileLayer';
import type { Site } from '../data/types';
import type { Level } from '../data/calc/link';
import { intermediate, vincenty } from '../data/calc/geo';
import { getHover, setHover, subscribeHover } from '../state/hover';

export interface MapLink {
  id: string;
  a: Site;
  b: Site;
  level: Level | 'none';
  label: string;
  /** Position of the narrowest clearance, 0..1 from site A (selected link only). */
  critT?: number | null;
}

export type MapMode = 'view' | 'add-site' | 'pick-link';

export interface FocusRequest {
  key: number;
  points: [number, number][];
}

interface Props {
  providerId: string;
  sites: Site[];
  links: MapLink[];
  selectedSiteId: string | null;
  selectedLinkId: string | null;
  pendingLinkSiteId: string | null;
  mode: MapMode;
  focus: FocusRequest | null;
  onMapClick(lat: number, lon: number): void;
  onSiteClick(id: string): void;
  onSiteMoved(id: string, lat: number, lon: number): void;
  onLinkClick(id: string): void;
  onView(center: [number, number], zoom: number): void;
  initialView: { center: [number, number]; zoom: number };
}

const LEVEL_COLOR: Record<Level | 'none', string> = { ok: '#1f9d5a', warn: '#d4891c', bad: '#d0453a', info: '#2f6fd6', none: '#7d8a97' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.TileLayer | null>(null);
  const siteLayer = useRef<L.LayerGroup | null>(null);
  const linkLayer = useRef<L.LayerGroup | null>(null);
  const cb = useRef(p);
  cb.current = p;

  /* create once */
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: 2 })
      .setView(p.initialView.center, p.initialView.zoom);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(m);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
    linkLayer.current = L.layerGroup().addTo(m);
    siteLayer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current.onMapClick(e.latlng.lat, e.latlng.lng));
    m.on('moveend', () => {
      const c = m.getCenter();
      cb.current.onView([c.lat, c.lng], m.getZoom());
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* base layer */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const prov = TILE_PROVIDERS.find((t) => t.id === p.providerId) || TILE_PROVIDERS[0];
    if (base.current) m.removeLayer(base.current);
    base.current = new CachedTileLayer(prov.url, {
      maxZoom: prov.maxZoom,
      maxNativeZoom: prov.maxZoom,
      subdomains: prov.subdomains || 'abc',
      attribution: prov.attribution,
      detectRetina: false
    }).addTo(m);
    base.current.bringToBack();
    el.current?.classList.toggle('map-dark', !!prov.dark);
  }, [p.providerId]);

  /* cursor for modes */
  useEffect(() => {
    el.current?.classList.toggle('map-adding', p.mode === 'add-site');
    el.current?.classList.toggle('map-picking', p.mode === 'pick-link');
  }, [p.mode]);

  /* sites */
  useEffect(() => {
    const layer = siteLayer.current;
    if (!layer) return;
    layer.clearLayers();
    p.sites.forEach((s) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      const sel = s.id === p.selectedSiteId;
      const pend = s.id === p.pendingLinkSiteId;
      const icon = L.divIcon({
        className: 'site-icon',
        html: `<div class="site-pin${sel ? ' is-selected' : ''}${pend ? ' is-pending' : ''}"></div><div class="site-label">${esc(s.name)}${s.code ? `<small>${esc(s.code)}</small>` : ''}</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      const mk = L.marker([s.lat, s.lon], { icon, draggable: sel && p.mode === 'view', keyboard: true, title: s.name, riseOnHover: true, autoPan: true });
      mk.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onSiteClick(s.id);
      });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        cb.current.onSiteMoved(s.id, ll.lat, ll.lng);
      });
      mk.addTo(layer);
    });
  }, [p.sites, p.selectedSiteId, p.pendingLinkSiteId, p.mode]);

  /* links */
  useEffect(() => {
    const layer = linkLayer.current, m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();
    p.links.forEach((l) => {
      if (![l.a.lat, l.a.lon, l.b.lat, l.b.lon].every(Number.isFinite)) return;
      const sel = l.id === p.selectedLinkId;
      const pts: L.LatLngExpression[] = [[l.a.lat, l.a.lon], [l.b.lat, l.b.lon]];
      if (sel) L.polyline(pts, { color: '#ffffff', weight: 9, opacity: 0.85, interactive: false }).addTo(layer);
      const line = L.polyline(pts, { color: LEVEL_COLOR[l.level], weight: sel ? 5 : 3.5, opacity: 0.95, lineCap: 'round' });
      line.addTo(layer);
      // wide invisible line: easier to hover and click than the thin visible one
      const hit = L.polyline(pts, { color: '#000000', weight: 18, opacity: 0, lineCap: 'round' });
      if (!sel) hit.bindTooltip(esc(l.label), { sticky: true, direction: 'top', className: 'link-tip' });
      hit.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onLinkClick(l.id);
      });
      if (sel) {
        hit.on('mousemove', (e: L.LeafletMouseEvent) => {
          const a = m.latLngToLayerPoint([l.a.lat, l.a.lon]), b = m.latLngToLayerPoint([l.b.lat, l.b.lon]), q = m.latLngToLayerPoint(e.latlng);
          const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy || 1;
          setHover({ linkId: l.id, t: Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len)), source: 'map' });
        });
        hit.on('mouseout', () => setHover(null));
        // distance ticks along the selected link
        const D = vincenty(l.a.lat, l.a.lon, l.b.lat, l.b.lon).km;
        const step = D <= 3 ? 0.25 : D <= 8 ? 0.5 : D <= 20 ? 1 : D <= 50 ? 2 : 5;
        for (let d = step; d < D - step * 0.3; d += step) {
          const [la, lo] = intermediate(l.a.lat, l.a.lon, l.b.lat, l.b.lon, d / D);
          L.circleMarker([la, lo], { radius: 3, color: LEVEL_COLOR[l.level], weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, interactive: false })
            .bindTooltip(`${String(+d.toFixed(2)).replace('.', ',')} км`, { permanent: false, direction: 'top' })
            .addTo(layer);
        }
        if (l.critT != null) {
          const [la, lo] = intermediate(l.a.lat, l.a.lon, l.b.lat, l.b.lon, l.critT);
          L.circleMarker([la, lo], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#d0453a', fillOpacity: 1, interactive: false }).addTo(layer);
        }
      }
      hit.addTo(layer);
    });
  }, [p.links, p.selectedLinkId]);

  /* cursor mirrored from the profile chart (or from the map itself) */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let mk: L.CircleMarker | null = null;
    const draw = () => {
      const h = getHover();
      const l = h ? cb.current.links.find((x) => x.id === h.linkId) : null;
      if (!h || !l) { if (mk) { mk.remove(); mk = null; } return; }
      const [la, lo] = intermediate(l.a.lat, l.a.lon, l.b.lat, l.b.lon, h.t);
      if (!mk) mk = L.circleMarker([la, lo], { radius: 7, color: '#ffffff', weight: 3, fillColor: '#1f63c9', fillOpacity: 1, interactive: false }).addTo(m);
      else mk.setLatLng([la, lo]);
    };
    const off = subscribeHover(draw);
    return () => { off(); if (mk) mk.remove(); };
  }, []);

  /* focus requests */
  useEffect(() => {
    const m = map.current;
    if (!m || !p.focus || !p.focus.points.length) return;
    const pts = p.focus.points.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (!pts.length) return;
    if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), 13));
    else m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
  }, [p.focus?.key]);

  return <div ref={el} className="map" aria-label="Карта площадок и пролётов" />;
}
