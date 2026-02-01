import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 初始化 OSM 背景地图
export function initOSMBackground(divId: string) {
  const map = L.map(divId, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false
  }).setView([49.011024, 8.410945], 18);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 22
  }).addTo(map);

  return map;
}

