
import * as THREE from "three";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
// import * as WEBIFC from "web-ifc";
// import * as FRAGS from "@thatopen/fragments";
import * as OBCF from "@thatopen/components-front";



// --- 1. INITIALISIERUNG DER BASIS-KOMPONENTEN ---
const components = new OBC.Components();

// Erstellung der Welt (Szene, Kamera, Renderer)
const worlds = components.get(OBC.Worlds);
const world = worlds.create<
  OBC.SimpleScene,
  OBC.OrthoPerspectiveCamera,
  OBC.SimpleRenderer
>();

world.scene = new OBC.SimpleScene(components);
world.scene.setup();
world.scene.three.background = null; // Transparenter Hintergrund

const container = document.getElementById("container")!;
world.renderer = new OBC.SimpleRenderer(components, container);
world.camera = new OBC.OrthoPerspectiveCamera(components);


// Standard-Kamerasicht festlegen
await world.camera.controls.setLookAt(78, 20, -2.2, 26, -4, 25);

// --- 2. FRAGMENT- UND WORKER-KONFIGURATION ---
// Einrichten des Workers für die IFC-Konvertierung im Hintergrund
const githubUrl = "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
const fetchedUrl = await fetch(githubUrl);
const workerBlob = await fetchedUrl.blob();
const workerFile = new File([workerBlob], "worker.mjs", { type: "text/javascript" });
const workerUrl = URL.createObjectURL(workerFile);

const fragments = components.get(OBC.FragmentsManager);
fragments.init(workerUrl);

components.init(); // Komponenten-System starten
components.get(OBC.Grids).create(world); // Hilfsgitter hinzufügen

const highlighter = components.get(OBCF.Highlighter);
highlighter.setup({ world });



// --- 3. IFC-LOADER SETUP ---
const ifcLoader = components.get(OBC.IfcLoader);

// Konfiguration der Web-IFC WASM-Module
await ifcLoader.setup({
  autoSetWasm: false,
  wasm: {
    path: "https://unpkg.com/web-ifc@0.0.74/",
    absolute: true,
  },
});

// Update-Logik für Fragmente bei Kamerabewegung
world.camera.controls.addEventListener("rest", () => fragments.core.update(true));
// -----------------------------

// Variablendefinition und Parameterübergabe für OSM-Karte
let osmPlane: THREE.Mesh | null = null;

const OSM_PARAMS = {
  scale: 1,
  offsetX: -8,
  offsetY: -3,
  offsetZ: -15,
  rotationY: 0
};

const toggleOSM = (visible: boolean) => {
  // Sicherstellen, dass die Welt und die Szene existieren, bevor wir versuchen, die Karte hinzuzufügen oder zu entfernen
  if (!world || !world.scene) return;

  if (visible) {
    if (!osmPlane) {
      const planeSize = 930;
      const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
      planeGeometry.rotateX(-Math.PI / 2);

      const textureLoader = new THREE.TextureLoader();
      // Aktuelle OSM-Karte: "osm.png"
      const osmTexture = textureLoader.load("osm.png");

      const planeMaterial = new THREE.MeshBasicMaterial({
        map: osmTexture,
        transparent: true,
        opacity: 1
      });

      osmPlane = new THREE.Mesh(planeGeometry, planeMaterial);
      osmPlane.scale.set(OSM_PARAMS.scale, 1, OSM_PARAMS.scale);
      osmPlane.rotation.y = OSM_PARAMS.rotationY;
      osmPlane.position.set(OSM_PARAMS.offsetX, OSM_PARAMS.offsetY, OSM_PARAMS.offsetZ);

      world.scene.three.add(osmPlane);
    }
    osmPlane.visible = true;
  } else {
    if (osmPlane) osmPlane.visible = false;
  }
};

fragments.list.onItemSet.add(({ value: model }) => {
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
});
// Z-Fighting verhindern (Vermeidung von flackernden Oberflächen)
fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
  if (!("isLodMaterial" in material && material.isLodMaterial)) {
    material.polygonOffset = true;
    material.polygonOffsetUnits = 1;
    material.polygonOffsetFactor = Math.random();
  }
});

// --- 4. FUNKTIONEN FÜR IFC-IMPORT UND EXPORT ---
const loadIfc = async (path: string) => {
  const file = await fetch(path);
  const data = await file.arrayBuffer();
  const buffer = new Uint8Array(data);

  // Wichtig: Das zweite Argument "true" aktiviert die Fragmentierung, damit jedes Bauteil als separates Fragment geladen wird
  const model = await ifcLoader.load(buffer, true, "example");
  await fragments.core.update(true);

  console.log("✅ Modell geladen");


  highlighter.events.select.onHighlight.add(async (selection) => {
    const infoBox = document.getElementById("info-box");
    const infoContent = document.getElementById("info-content");
    if (!infoBox || !infoContent) return;

    const fragmentID = Object.keys(selection)[0];
    const expressIDs = Array.from(selection[fragmentID]).map(Number);
    const idNum = expressIDs[0];
    if (!idNum) return;

    /* Definition der manuellen Mapping-Tabelle & benutzerdefinierte Daten */
    const typZuordnung: Record<string, { de: string, ifc: string }> = {
      "Wände": { de: "Wände", ifc: "IfcWall" },
      "Türen": { de: "Türen", ifc: "IfcDoor" },
      "Fenster": { de: "Fenster", ifc: "IfcWindow" },
      "Räume": { de: "Räume", ifc: "IfcSpace" },
      "Bodenplatten": { de: "Bodenplatten/Decken", ifc: "IfcSlab" },
      "Träger/Stützen": { de: "Träger / Stützen", ifc: "IfcMember" },
      "Andere Bauteile": { de: "Sonstige Bauteile", ifc: "IfcBuildingElement" }
    };




    // benutzerdefinierte Metadaten für bestimmte Räume 
    /* const customMetadata: Record<number, { name: string, faku: string, tpye: string, id: string, info?: string, color?: string }> = {
        28910: { 
            name: "JORDAN-HÖRSAAL", 
            faku: "Geodätischen Institut (GIK)",
            tpye: "Lecture Hall",
            id : "002",
            info: "...",
            color: "#4CAF50" 
        },
    }; */

    /* Kernlogik: Finder-Test ausführen (Typbestimmung) */
    let erkanntDe = "Unbekannt";
    let erkanntIfc = "IfcElement";

    for (const gruppenName in typZuordnung) {
      const finderQuery = finder.list.get(gruppenName);
      if (finderQuery) {
        const result = await finderQuery.test();
        if (result[fragmentID] && result[fragmentID].has(idNum)) {
          erkanntDe = typZuordnung[gruppenName].de;
          erkanntIfc = typZuordnung[gruppenName].ifc;
          break;
        }
      }
    }

    /* Attribute abrufen & benutzerdefinierte Space-Daten anwenden */
    const props = (model as any).properties?.[idNum];

    // Standardwerte initialisieren
    let bauteilName = props?.Name?.value || `${erkanntIfc} #${idNum}`;
    let nameColor = "inherit";
    let spaceDetailsHtml = ""; // Container für Space-spezifische HTML-Struktur

    // Nur wenn es sich um einen Raum handelt, benutzerdefinierte Daten anwenden und erweitertes Layout anzeigen
    /* if (erkanntIfc === "IfcSpace") {
        const data = customMetadata[idNum];
        if (data) {
            bauteilName = data.name;
            nameColor = data.color || "#E65100"; 
            
            // Erweiterte HTML-Struktur für Raumdetails mit klarer Trennung und besserer Lesbarkeit
            spaceDetailsHtml = `
                <div style="margin-top: 8px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 0.9em; line-height: 1.6;">
                    <div><b style="color: #666;">Raum-ID:</b> ${data.id}</div>
                    <div><b style="color: #666;">Typ:</b> ${data.tpye}</div>
                    <div><b style="color: #666;">Fakultät:</b> ${data.faku}</div>
                    ${data.info ? `<div style="margin-top: 4px; color: #888; font-style: italic;">Note: ${data.info}</div>` : ""}
                </div>
            `;
        }
    }*/

    /* UI-Anzeige aktualisieren */
    infoBox.style.display = "block";
    infoContent.innerHTML = `
        <div style="border-bottom: 2px solid #2196F3; margin-bottom: 10px; padding-bottom: 5px;">
            <strong style="color: #2196F3; font-size: 1.1em;">Bauteil-Informationen</strong>
        </div>

        <div style="margin-bottom: 8px;">
            <b>Kategorie:</b> 
            <span style="background: #E91E63; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 0.85em;">
                ${erkanntDe}
            </span>
        </div>

        <div style="margin-bottom: 6px;">
            <b>IFC-Typ:</b> 
            <span style="color: #4CAF50; font-family: monospace; font-weight: bold;">
                ${erkanntIfc}
            </span>
        </div>

        <div style="margin-bottom: 6px;">
            <b>Name:</b> 
            <span style="color: ${nameColor}; font-weight: bold;">${bauteilName}</span>
        </div>

        ${spaceDetailsHtml}

        <div style="font-size: 0.75em; color: #888; margin-top: 10px; border-top: 1px dashed #ddd; padding-top: 5px;">
            ExpressID: <code>${idNum}</code>
        </div>
    `;
  });
};

/* const downloadFragments = async () => {
  const [model] = fragments.list.values();
  if (!model) return;
  const fragsBuffer = await model.getBuffer(false);
  const file = new File([fragsBuffer], "projekt_modell.frag");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
}; */

const fragmentIfcLoader = components.get(OBC.IfcLoader);
await fragmentIfcLoader.setup();
const autoLoadModel = async () => {
  console.log("🚀 Starte automatischen Modell-Download...");
  try {
    // Hier kannst du den Pfad zu deinem IFC-Modell anpassen (lokal oder remote)
    await loadIfc("GuG_buildingV3.ifc");
    toggleOSM(true);

    // Optional: Direkt nach dem Laden die Ansicht auf eine gute Perspektive setzen
    updatePanel();

    console.log("🎯 Modell erfolgreich automatisch geladen");
  } catch (error) {
    console.error("❌ Fehler beim automatischen Laden:", error);
  }
};

// 3. Automatischer Modell-Download beim Start der Anwendung
autoLoadModel();

// --- 5. ITEMS FINDER: FILTER FÜR BAUTEILE ---


const finder = components.get(OBC.ItemsFinder);

finder.create("Wände", [{ categories: [/WALL/i] }]);
finder.create("Türen", [{ categories: [/DOOR/i] }]);
finder.create("Fenster", [{ categories: [/WINDOW/i] }]);
finder.create("Räume", [{ categories: [/SPACE/i] }]);
finder.create("Bodenplatten", [{ categories: [/SLAB/i] }]);
finder.create("Träger/Stützen", [{ categories: [/MEMBER|COLUMN|BEAM/i] }]);
finder.create("Andere Bauteile", [{ categories: [/PROXY|ROOF|FURNISHING/i] }]);

const getResult = async (name: string) => {
  const finderQuery = finder.list.get(name);
  if (!finderQuery) return {};
  return await finderQuery.test(); // Gibt FragmentID-Map zurück
};
/* ==========================================
 * 1. Data Section: Manuelle Mapping-Tabelle & benutzerdefinierte Raumdaten
 * ========================================== */
const customMetadata: Record<number, { name: string, type: string, id: string, etage: string, info?: string }> = {
  28910: {
    name: "JORDAN-HÖRSAAL",
    type: "Lecture Hall",
    id: "002",
    etage: "EG",
    info: "..."
  },
  35597: {
    name: "SKY-HÖRSAAL",
    type: "Lecture Hall",
    id: "048",
    etage: "EG",
    info: "..."
  },
  43656: {
    name: "GIK Büro und Sekretariat",
    type: "Büro",
    id: "041",
    etage: "EG",
    info: "..."
  },
  35609: {
    name: "HAID-HÖRSAAL",
    type: "Lecture Hall",
    id: "040",
    etage: "EG",
    info: "..."
  },
  35621: {
    name: "PC-Pool",
    type: "Computer Pool",
    id: "039",
    etage: "EG",
    info: "..."
  },
  43786: {
    name: "GIK Büro und Besprechungsraum",
    type: "Büro und Besprechungsraum",
    id: "034",
    etage: "EG",
    info: "..."
  },
  43834: {
    name: "IPF Besprechungsraum",
    type: "Besprechungsraum",
    id: "028",
    etage: "EG",
    info: "..."
  },
  43910: {
    name: "FRITZ-HALLER-HÖRSAAL(HS37)",
    type: "Lecture Hall",
    id: "001",
    etage: "EG",
    info: "..."
  },
  43789: {
    name: "Fakultätsbibliothek",
    type: "Bibliothek",
    id: "005",
    etage: "EG",
    info: "..."
  },
  43498: {
    name: "Neuer-HÖRSAAL",
    type: "Lecture Hall",
    id: "003",
    etage: "EG",
    info: "..."
  },
  43587: {
    name: "EGON-EIERMANN-HÖRSAAL(HS16)",
    type: "Lecture Hall",
    id: "101",
    etage: "1OG",
    info: "..."
  },
  43603: {
    name: "HÖRSAAL 9",
    type: "Lecture Hall",
    id: "102",
    etage: "1OG",
    info: "..."
  },
  43865: {
    name: "Zeichnensaal",
    type: "Lecture Hall",
    id: "204",
    etage: "2OG",
    info: "..."
  },
  43851: {
    name: "Observatorium",
    type: "Observatorium",
    id: "301",
    etage: "Dach",
    info: "..."
  }
  // Hier kannst du weitere Räume hinzufügen, indem du die Fragment-ID als Schlüssel und die entsprechenden Metadaten als Wert einfügst
};

const roomsByFloor: Record<string, { id: number, name: string }[]> = {
  "KL": [],// hier kannst du die Keller-Räume hinzufügen, z.B. "KL": [{ id: 12345, name: "Kellerraum 1" }, ...]
  "EG": [{ id: 28910, name: "Jordan-Hörsaal" }, { id: 35597, name: "Sky-Hörsaal" }, { id: 43656, name: "GIK Büro und Sekretariat" }, { id: 35609, name: "Haid-Hörsaal" }, { id: 35621, name: "PC-Pool" }, { id: 43786, name: "GIK Büro und Besprechungsraum" }, { id: 43834, name: "IPF Besprechungsraum" }, { id: 43910, name: "Fritz-Haller-Hörsaal(HS37)" }, { id: 43789, name: "Fakultätsbibliothek" }, { id: 43498, name: "Neuer-Hörsaal" }],
  "1OG": [{ id: 43587, name: "Egon-Eiermann-Hörsaal(HS16)" }, { id: 43603, name: "Hörsaal 9" }], // hier kannst du die 1. OG-Räume hinzufügen
  "2OG": [{ id: 43865, name: "Zeichnensaal" }], // hier kannst du die 2. OG-Räume hinzufügen
  "Dach": [{ id: 43851, name: "Observatorium" }] // hier kannst du die Dachgeschoss-Räume hinzufügen
};

/* ==========================================
 * 2. Logic Section: Funktionen für Sichtwechsel, Raumisolierung und UI-Interaktion
 * ========================================== */

// --- A. Ansicht setBirdView ---
const setBirdView = () => {
  if (!world.scene || !world.camera) return;

  const sceneBounds = new THREE.Box3();

  // 1. Berechnung der Szenengrenzen basierend auf allen Fragmenten
  fragments.list.forEach((model: any) => {
    const obj = model.object || model.mesh || model.group;
    if (obj) sceneBounds.expandByObject(obj);
  });

  if (sceneBounds.isEmpty()) {
    sceneBounds.setFromObject(world.scene.three);
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  sceneBounds.getCenter(center);
  sceneBounds.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(maxDim, 20) * 0.8;

  // der Offset wird so berechnet, dass die Kamera in einem 45-Grad-Winkel von oben auf die Szene blickt
  const offset = new THREE.Vector3(
    0,                  // X keine seitliche Verschiebung
    distance * 1.0,     // Y nach oben (Höhe der Kamera)
    distance * 1.0      // Z nach hinten (Entfernung von der Szene)
  );

  // 2️⃣ Kamera-Positionierung: Setze die Kamera mit einem 45-Grad-Winkel auf die Szene
  (world.camera as OBC.SimpleCamera).controls.setLookAt(
    center.x + offset.x, center.y + offset.y, center.z + offset.z, // Kameraposition
    center.x, center.y, center.z,                                   // Blickpunkt (Szenenzentrum)
    true                                                           // sanftes Übergang
  );
};

// --- B. isolateSpaces ---
const isolateSpaces = async (targetIDs?: number[]) => {
  const roomResults = await finder.list.get("Räume")?.test();
  if (!roomResults) {
    console.error("Finder 'Räume' not found!");
    return;
  }

  // 1. alle Modelle durchgehen, um die relevanten Fragmente zu finden
  for (const [modelID, model] of fragments.list) {
    // 2. Jedes Fragment im Modell durchgehen und prüfen, ob es Raum-IDs enthält
    const frags = (model as any).items as any[];
    if (!frags) continue;

    frags.forEach((frag: any) => {
      const idsInFrag = roomResults[frag.id];

      if (idsInFrag && idsInFrag.size > 0) {
        //  3. Wenn das Fragment Raum-IDs enthält, prüfen wir, ob es die Ziel-IDs enthält (für Einzelauswahl) oder einfach alle anzeigen (für Gesamtansicht)
        if (targetIDs) {
          // Einzelraum-Modus: Nur die Fragmente anzeigen, die die ausgewählten Raum-IDs enthalten
          const filteredIDs = Array.from(idsInFrag).filter(id => targetIDs.includes(id as number));

          if (filteredIDs.length > 0) {
            frag.setVisibility(true);
            // Alle IDs im Fragment zunächst ausblenden, dann nur die gefilterten IDs anzeigen
            frag.setItemsVisibility(Array.from(idsInFrag), false);
            frag.setItemsVisibility(filteredIDs, true);
          } else {

            frag.setVisibility(false);
          }
        } else {
          // Gesamtansicht-Modus: Alle Fragmente mit Raum-IDs anzeigen
          frag.setVisibility(true);
          frag.setItemsVisibility(Array.from(idsInFrag), true);
        }
      } else {

        frag.setVisibility(false);
      }
    });
  }
};
/* ==========================================
 * 4. UI INTERAKTION: Event-Listener für Buttons und Dropdowns, um die oben definierten Funktionen zu triggern
 * ========================================== */

const setupInteractionMenu = () => {
  // 1. Element-Referenzen
  const showAllBtn = document.getElementById("show-all-spaces");
  const floorSelect = document.getElementById("floor-select") as HTMLSelectElement;
  // für die Raum-Auswahl brauchen wir einen weiteren Dropdown, den wir in HTML mit id="room-select" definieren müssen
  const roomSelect = document.getElementById("room-select") as HTMLSelectElement;
  const topBar = document.getElementById("top-info-bar");
  const resetViewBtn = document.getElementById("reset-view") as HTMLButtonElement;

  // --- A. "Alle Räume anzeigen" ---
  // Definieren eines neuen Materials für die blaue Hervorhebung (Sky Blue Stil)
  const blueHighlightMaterial = {

    color: new THREE.Color(0x90CAF9),

    renderedFaces: 2,

    // Leicht transparente Optik, damit die darunterliegenden Details noch sichtbar bleiben
    opacity: 0.5,


    transparent: true,
  };

  showAllBtn?.addEventListener("click", async () => {
    console.log("Alle Räume anzeigen...");

    // 1️⃣ anpassung der Kameraperspektive auf Vogelperspektive
    if (typeof setBirdView === "function") setBirdView();

    // 2️⃣ Ergebnis aller Räume abrufen (für die Gesamtansicht) - hier brauchen wir alle IDs, um sie später blau zu highlighten
    const roomResults = await getResult("Räume");
    if (!roomResults) return;

    // 3️⃣ hider-Komponente verwenden, um alle Räume zu isolieren (sichtbar zu machen) - wir übergeben alle IDs, damit sie nicht ausgeblendet werden
    const hider = components.get(OBC.Hider);
    await hider.isolate(roomResults);

    // 4️⃣ Alle Raum-IDs sammeln, um sie später blau zu highlighten
    const allRoomIds: number[] = [];
    for (const fragID in roomResults) {
      roomResults[fragID].forEach((id) => allRoomIds.push(id as number));
    }

    // 5️⃣ Alle Modelle durchgehen und die gesammelten Raum-IDs mit dem blauen Material hervorheben
    for (const [id, model] of fragments.list) {
      try {
        await (model as any).resetHighlight();
        if (allRoomIds.length > 0) {
          await (model as any).highlight(allRoomIds, blueHighlightMaterial);
        }
      } catch (e) {
        console.warn(`Modell ${id} falsch:`, e);
      }
    }

    // Fragment-Update erzwingen, damit die Änderungen sofort sichtbar werden
    if (fragments.core && fragments.core.update) {
      await fragments.core.update(true);
    } else if ((fragments as any).update) {
      await (fragments as any).update(true);
    }

    // 6️⃣ Update der Top-Bar mit einem klaren Hinweis auf die aktuelle Ansicht
    if (topBar) {
      topBar.innerText = "Ansicht: Alle Räume (Blau markiert)";
      topBar.style.display = "block";
    }
  });

  // Etage wählen 
  floorSelect?.addEventListener("change", () => {
    const selectedFloor = floorSelect.value;
    console.log("Etage auswählen:", selectedFloor);


    if (roomSelect) {
      roomSelect.innerHTML = '<option value="none">-- Raum wählen --</option>';

      // Aktualisieren der Raum-Auswahl basierend auf der ausgewählten Etage
      if (roomsByFloor[selectedFloor]) {
        roomsByFloor[selectedFloor].forEach(room => {
          const opt = document.createElement("option");
          opt.value = room.id.toString();
          opt.innerText = room.name;
          roomSelect.appendChild(opt);
        });
      }
    }

  });

  // Raum wählen (Einzelauswahl + Highlight)

  const highlightMaterial = {
    color: new THREE.Color("gold"),
    renderedFaces: 2, // FRAGS.RenderedFaces.TWO
    opacity: 1,
    transparent: false,
  };

  // 2. Variable, um die aktuelle Modell-Instanz zu speichern, damit wir später darauf zugreifen können (z.B. für Highlighting oder Metadatenabruf)
  let currentModel: any = null;

  // 3. Funktion zum Laden eines IFC-Modells, die das geladene Modell in der Variable currentModel speichert, damit wir später darauf zugreifen können (z.B. für Highlighting oder Metadatenabruf)
  const loadIfc = async (path: string) => {
    const file = await fetch(path);
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);

    // Wichtig: Das zweite Argument "true" aktiviert die Fragmentierung
    const model = await ifcLoader.load(buffer, true, "example");

    // Das geladene Modell in der Variable currentModel speichern, damit wir später darauf zugreifen können (z.B. für Highlighting oder Metadatenabruf)
    currentModel = model;

    await fragments.core.update(true);
    console.log("✅ Modell geladen");
  };

  // 4. Event-Listener für die Raum-Auswahl, der die Isolierung, das Highlighting und die Metadatenanzeige basierend auf der ausgewählten Raum-ID durchführt
  roomSelect?.addEventListener("click", async () => {
    const roomId = parseInt(roomSelect.value);
    if (isNaN(roomId)) return;


    if (typeof setOrientation === "function") setOrientation("Oben");

    const roomResults = await getResult("Räume");
    const singleRoomResult: Record<string, Set<number>> = {};
    for (const fragID in roomResults) {
      if (roomResults[fragID].has(roomId)) {
        singleRoomResult[fragID] = new Set([roomId]);
        break;
      }
    }
    const hider = components.get(OBC.Hider);
    await hider.isolate(singleRoomResult);

    for (const [id, model] of fragments.list) {
      try {
        await (model as any).resetHighlight();
        await (model as any).highlight([roomId], highlightMaterial);
      } catch (e) { }
    }

    if (fragments.core?.update) await fragments.core.update(true);


    if (topBar) {
      // 1️⃣ Abrufen der benutzerdefinierten Metadaten für den ausgewählten Raum basierend auf der Raum-ID
      const data = customMetadata[roomId];

      if (data) {
        // 2️⃣ Wenn Metadaten vorhanden sind, Anzeige in der Top-Bar mit einem ansprechenden Layout
        topBar.innerHTML = `
        <div style="display: flex; gap: 15px; align-items: center; justify-content: center;">
          <span style="font-weight: bold; color: #ffeb3b;">📍 ${data.name}</span>
          <span style="font-size: 0.9em; opacity: 0.9;">| Typ: ${data.type}</span>
          <span style="font-size: 0.9em; opacity: 0.9;">| ID: ${data.id}</span>
          <span style="font-size: 0.9em; opacity: 0.9;">| Etage: ${data.etage}</span>
        </div>
      `;
      } else {
        // 3️⃣ Wenn keine Metadaten gefunden wurden, trotzdem die Raum-ID anzeigen, damit der Nutzer weiß, dass etwas ausgewählt wurde
        topBar.innerText = `Focus: Raum ${roomId} (Keine Metadaten gefunden)`;
      }
      topBar.style.display = "block";
    }

  });
  // 5. Event-Listener für den "Reset View"-Button, der die Gesamtansicht wiederherstellt, alle Räume anzeigt und die Top-Bar zurücksetzt
  resetViewBtn?.addEventListener("click", async () => {
    // 1. Logik: Alle Räume anzeigen (Gesamtansicht) - wir übergeben keine IDs, damit alle Räume sichtbar werden
    if (typeof isolateSpaces === "function") {
      await isolateSpaces();
    }

    // 2. Kamera zurücksetzen: Wir können entweder die ursprüngliche Kameraposition speichern und hier wiederherstellen oder einfach die Vogelperspektive erneut setzen, um eine gute Gesamtansicht zu gewährleisten
    if (typeof setBirdView === "function") {
      setBirdView();
    }

    // 3. Top-Bar zurücksetzen: Inhalt leeren und ausblenden, damit sie nicht mehr stört
    if (topBar) {
      topBar.style.display = "none";
      topBar.innerHTML = ""; // Inhalt leeren
    }
    const infoBox = document.getElementById("info-box");
    const infoContent = document.getElementById("info-content");
    if (infoBox && infoContent) {
      infoBox.style.display = "none";
      infoContent.innerHTML = ""; // Inhalt leeren
    }


    // 4. Raum-Auswahl zurücksetzen: Dropdown auf den Standardwert zurücksetzen, damit es klar ist, dass keine spezifische Auswahl mehr aktiv ist
    if (roomSelect) {
      roomSelect.value = "";
    }

    // 5. Alle Modelle durchgehen und alle Hervorhebungen zurücksetzen, damit die Gesamtansicht wieder sauber und ohne Markierungen ist
    for (const [id, model] of fragments.list) {
      try {
        await (model as any).resetHighlight();
      } catch (e) {
        console.warn("Hervorhebung zurücksetzen fehlgeschlagen:", e);
      }
    }

    // 6. Fragment-Update erzwingen, damit alle Änderungen sofort sichtbar werden
    if (fragments.core?.update) {
      await fragments.core.update(true);
    }

    console.log("🔄 Gesamtansicht zurückgesetzt: Alle Räume sichtbar, keine Hervorhebungen mehr.");
  });
};

// 5. Aufruf der Funktion zum Einrichten des Interaktionsmenüs, damit die Event-Listener aktiv sind und die UI reagiert
setupInteractionMenu();




// --- 6. BENUTZEROBERFLÄCHE (UI) MIT BUI ---
BUI.Manager.init();

type QueriesListTableData = { Name: string; Actions: string; };

const setOrientation = (side: string) => {
  if (!world.scene || !world.camera) return;

  const sceneBounds = new THREE.Box3();
  fragments.list.forEach((model: any) => {
    if (model.object) {
      sceneBounds.expandByObject(model.object);
    } else if (model.mesh) {
      sceneBounds.expandByObject(model.mesh);
    }
  });

  // Wenn keine Modelle geladen sind, dann die gesamte Szene (inkl. Karte) verwenden
  if (sceneBounds.isEmpty()) {
    sceneBounds.setFromObject(world.scene.three);
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  sceneBounds.getCenter(center);
  sceneBounds.getSize(size);

  // Abstand basierend auf der größten Ausdehnung der Szene berechnen, um sicherzustellen, dass die gesamte Szene in der Ansicht bleibt
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(maxDim, 20) * 1.5;

  let offset = new THREE.Vector3();
  switch (side) {
    case "Oben": offset.set(0, distance, 0); break;
    case "Unten": offset.set(0, -distance, 0); break;
    case "Vorne": offset.set(0, 0, distance); break;
    case "Hinten": offset.set(0, 0, -distance); break;
    case "Links": offset.set(-distance, 0, 0); break;
    case "Rechts": offset.set(distance, 0, 0); break;
  }

  (world.camera as OBC.SimpleCamera).controls.setLookAt(
    center.x + offset.x, center.y + offset.y, center.z + offset.z,
    center.x, center.y, center.z,
    true
  );
};

// Tabelle für die Filter-Abfragen
const queriesList = BUI.Component.create<BUI.Table<QueriesListTableData>>(() => {
  const onCreated = (e?: Element) => {
    if (!e) return;
    const table = e as BUI.Table<QueriesListTableData>;
    table.loadFunction = async () => {
      const data: BUI.TableGroupData<QueriesListTableData>[] = [];
      for (const [name] of finder.list) {
        data.push({ data: { Name: name, Actions: "" } });
      }
      return data;
    };
    table.loadData(true);
  };
  return BUI.html`<bim-table ${BUI.ref(onCreated)}></bim-table>`;
});
const onOSMToggled = (e: Event) => {
  const target = e.target as any;
  const isChecked = target.value;
  toggleOSM(isChecked);
};

// Tabellen-Konfiguration und Interaktion (Bauteile isolieren)
queriesList.style.maxHeight = "20rem";
queriesList.columns = ["Name", { name: "Actions", width: "auto" }];
queriesList.dataTransform = {
  Actions: (_, rowData) => {
    const { Name } = rowData;
    if (!Name) return _;
    return BUI.html`
      <bim-button icon="solar:cursor-bold" @click=${async ({ target }: any) => {
        target.loading = true;
        const result = await getResult(Name);
        await components.get(OBC.Hider).isolate(result);
        target.loading = false;
      }}></bim-button>`;
  },
};

// --- 7. DAS HAUPTPANEL ---
const [mainPanel, updatePanel] = BUI.Component.create<BUI.Panel, {}>((state) => {
  const isModelLoaded = fragments.list.size > 0;
  return BUI.html`
    <bim-panel active label="BIM Management Center" class="options-menu">
      
      <bim-panel-section label="Modell-Verwaltung" icon="solar:settings-bold">
        
        <bim-button label="Alles anzeigen" @click=${() => components.get(OBC.Hider).set(true)}></bim-button>
      </bim-panel-section>

      <bim-panel-section label="Umgebung" icon="solar:map-bold" .collapsed=${!isModelLoaded}>
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <bim-checkbox 
            label="OSM-Karte anzeigen"
            @change=${(onOSMToggled)}>
          </bim-checkbox>
        </div>
      </bim-panel-section>
      <bim-panel-section label="Schnellansichten" icon="solar:camera-bold" .collapsed=${!isModelLoaded}>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
          <bim-button label="Oben" @click=${() => setOrientation("Oben")}></bim-button>
          <bim-button label="Unten" @click=${() => setOrientation("Unten")}></bim-button>
          <bim-button label="Vorne" @click=${() => setOrientation("Vorne")}></bim-button>
          <bim-button label="Hinten" @click=${() => setOrientation("Hinten")}></bim-button>
          <bim-button label="Links" @click=${() => setOrientation("Links")}></bim-button>
          <bim-button label="Rechts" @click=${() => setOrientation("Rechts")}></bim-button>
        </div>
      </bim-panel-section>

      <bim-panel-section label="Filter & Kategorien" icon="solar:magnifer-bold" .collapsed=${!isModelLoaded}>
        ${queriesList}
      </bim-panel-section>

    </bim-panel>
  `;
}, {});

// Panel im Dokument anzeigen
document.body.append(mainPanel);

// UI automatisch aktualisieren, wenn neue Fragmente geladen werden
fragments.list.onItemSet.add(() => {
  updatePanel();
  (queriesList as any).loadData?.(true);
});


