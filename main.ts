
import * as THREE from "three";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
//import * as WEBIFC from "web-ifc";
//import * as FRAGS from "@thatopen/fragments";
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

// Wenn ein Modell geladen wird, zur Szene hinzufügen
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
// --- 5. ITEMS FINDER: FILTER FÜR BAUTEILE ---
const finder = components.get(OBC.ItemsFinder);

// Filterregeln definieren
finder.create("Wände", [{ categories: [/WALL/i] }]);
finder.create("Türen", [{ categories: [/DOOR/i] }]);
finder.create("Fenster", [{ categories: [/WINDOW/i] }]);
finder.create("Andere Bauteile", [{ 
  categories: [/SLAB/i, /ROOF/i, /FURNISHING/i, /PROXY/i, /MEMBER/i] 
}]);

/* ===============================
 * 1️⃣ IFC-MODELL LADEN & FRAGMENTS SYNCHRONISIEREN
 * 2️⃣ KATEGORIE-ERKENNUNG BEI SELEKTION
 * 3️⃣ IFC-ATTRIBUTE AUSLESEN & ANZEIGEN
 * =============================== */

const loadIfc = async (path: string) => {
    const file = await fetch(path);
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);

    // 加载模型并确保属性同步
    const model = await ifcLoader.load(buffer, true, "example");
    await fragments.core.update(true);

    console.log("✅ Modell geladen");

    
highlighter.events.select.onHighlight.add(async (selection) => {
    const infoBox = document.getElementById("info-box");
    const infoContent = document.getElementById("info-content");
    if (!infoBox || !infoContent) return;

    // 1. Gewählte IDs extrahieren
    const fragmentID = Object.keys(selection)[0];
    const expressIDs = Array.from(selection[fragmentID]).map(Number);
    const idNum = expressIDs[0];
    if (!idNum) return;

    /* ===============================
     * 2️⃣ KATEGORIE-CHECK (Dein Standard)
     * =============================== */
    let erkanntTyp = "Andere Bauteile";
    
    // Wir gehen deine definierten Kategorien durch
    const kategorien = ["Wände", "Türen", "Fenster", "Andere Bauteile"];

    for (const name of kategorien) {
        const finderQuery = finder.list.get(name);
        if (finderQuery) {
            // Wir führen den Test aus, um die aktuelle Map zu erhalten
            const result = await finderQuery.test(); 
            
            // Das Ergebnis von test() ist eine Map: [fragmentID: Set<expressID>]
            // Wir prüfen, ob unsere fragmentID und idNum darin enthalten sind
            if (result[fragmentID] && result[fragmentID].has(idNum)) {
                erkanntTyp = name;
                break;
            }
        }
    }

    /* ===============================
     * 3️⃣ IFC ATTRIBUTE & UI
     * =============================== */
    const modelWithProps = model as any;
    const props = modelWithProps.properties ? modelWithProps.properties[idNum] : null;

    const bauteilName = props?.Name?.value || `Bauteil #${idNum}`;
    const globalId = props?.GlobalId?.value || "—";
    const ifcClass = props?.type || "IFC Element";

    infoBox.style.display = "block";
    infoContent.innerHTML = `
        <div style="border-bottom: 2px solid #2196F3; margin-bottom: 8px; padding-bottom: 4px;">
            <strong style="color: #2196F3;">Bauteil-Informationen</strong>
        </div>

        <div style="margin-bottom: 8px;">
            <b>Kategorie:</b> 
            <span style="background: #E91E63; color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;">
                ${erkanntTyp}
            </span>
        </div>

        <div style="margin-bottom: 4px;"><b>IFC-Klasse:</b> ${ifcClass}</div>
        <div style="margin-bottom: 4px;"><b>Name:</b> ${bauteilName}</div>
        <div style="margin-bottom: 4px;"><b>GlobalID:</b> <small>${globalId}</small></div>

        <div style="font-size: 0.8em; color: #888; margin-top: 10px; border-top: 1px dashed #ddd; padding-top: 5px;">
            ExpressID: ${idNum}
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



const getResult = async (name: string) => {
  const finderQuery = finder.list.get(name);
  if (!finderQuery) return {};
  return await finderQuery.test(); // Gibt FragmentID-Map zurück
};


// --- 6. BENUTZEROBERFLÄCHE (UI) MIT BUI ---
BUI.Manager.init();

type QueriesListTableData = { Name: string; Actions: string; };

// Kamera-Navigation zu vordefinierten Ansichten
const setOrientation = (side: string) => {
  if (!world.scene || !world.camera) return;
  const sceneBounds = new THREE.Box3().setFromObject(world.scene.three);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  sceneBounds.getCenter(center);
  sceneBounds.getSize(size);
  const distance = Math.max(size.x, size.y, size.z, 20) * 1.5;
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
    center.x, center.y, center.z, true
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

// Tabellen-Konfiguration und Interaktion (Bauteile isolieren)
queriesList.style.maxHeight = "20rem";
queriesList.columns = ["Name", { name: "Actions", width: "auto" }];
queriesList.dataTransform = {
  Actions: (_, rowData) => {
    const { Name } = rowData;
    if (!Name) return _;
    return BUI.html`
      <bim-button icon="solar:cursor-bold" @click=${async ({target}: any) => {
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
          ? BUI.html`<bim-button label="IFC-Datei laden" @click=${async ({target}: any) => {
              target.loading = true;
              await loadIfc("GuG_buildingV3.ifc");
              target.loading = false;
              updatePanel();
            }}></bim-button>` 
          : BUI.html`<bim-button label="Fragments herunterladen" @click=${downloadFragments}></bim-button>`}
        <bim-button label="Alles anzeigen" @click=${() => components.get(OBC.Hider).set(true)}></bim-button>
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


