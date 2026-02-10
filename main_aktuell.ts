
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
    const customMetadata: Record<number, { name: string, faku: string, tpye: string, id: string, info?: string, color?: string }> = {
        28910: { 
            name: "JORDAN-HÖRSAAL", 
            faku: "Geodätischen Institut (GIK)",
            tpye: "Lecture Hall",
            id : "002",
            info: "...",
            color: "#4CAF50" 
        },
    };

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
    if (erkanntIfc === "IfcSpace") {
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
    }

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

const downloadFragments = async () => {
  const [model] = fragments.list.values();
  if (!model) return;
  const fragsBuffer = await model.getBuffer(false);
  const file = new File([fragsBuffer], "projekt_modell.frag");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
};
const fragmentIfcLoader = components.get(OBC.IfcLoader);
await fragmentIfcLoader.setup();
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
        ${!isModelLoaded
      ? BUI.html`<bim-button label="IFC-Datei laden" @click=${async ({ target }: any) => {
        target.loading = true;
        // Aktuelle IFC Datei: "building.ifc" 
        await loadIfc("building.ifc");
        target.loading = false;
        updatePanel();
      }}></bim-button>`
      : BUI.html`<bim-button label="Fragments herunterladen" @click=${downloadFragments}></bim-button>`}
        <bim-button label="Alles anzeigen" @click=${() => components.get(OBC.Hider).set(true)}></bim-button>
      </bim-panel-section>

      <bim-panel-section label="Umgebung" icon="solar:map-bold" .collapsed=${!isModelLoaded}>
        <div style="display: flex; flex-direction: column; gap: 5px;">
          <bim-checkbox 
            label="OSM-Karte anzeigen" 
            @change=${onOSMToggled}>
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


