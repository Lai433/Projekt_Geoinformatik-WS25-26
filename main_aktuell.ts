
import * as THREE from "three";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as WEBIFC from "web-ifc";
import * as FRAGS from "@thatopen/fragments";
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

// 保持之前的变量和参数定义
let osmPlane: THREE.Mesh | null = null;

const OSM_PARAMS = {
  scale: 1,
  offsetX: 35,
  offsetZ: -58,
  rotationY: 0.68 
};

const toggleOSM = (visible: boolean) => {
  // 确保 world 已经初始化，否则会报错
  if (!world || !world.scene) return; 

  if (visible) {
    if (!osmPlane) {
      const planeSize = 750;
      const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
      planeGeometry.rotateX(-Math.PI / 2);

      const textureLoader = new THREE.TextureLoader();
      // 提示：确保 map.png 放在 public 文件夹下
      const osmTexture = textureLoader.load("./map.png");

      const planeMaterial = new THREE.MeshBasicMaterial({ 
        map: osmTexture,
        transparent: true,
        opacity: 1
      });
      
      osmPlane = new THREE.Mesh(planeGeometry, planeMaterial);
      osmPlane.scale.set(OSM_PARAMS.scale, 1, OSM_PARAMS.scale);
      osmPlane.rotation.y = OSM_PARAMS.rotationY;
      // Y 设置为 -0.1 防止 Z-Fighting
      osmPlane.position.set(OSM_PARAMS.offsetX, -0.1, OSM_PARAMS.offsetZ); 

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
  
  console.log("IFC-Konvertierung gestartet...");
  
  const model = await ifcLoader.load(buffer, false, "example", {
    processData: {
      progressCallback: (progress) => console.log(`Fortschritt: ${Math.round(progress * 100)}%`),
    },
  });

  // Wichtig: Daten vom Worker in den Haupt-Thread synchronisieren
  await fragments.core.update(true);
  console.log("IFC-Konvertierung abgeschlossen.");
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

// --- 5. ITEMS FINDER: FILTER FÜR BAUTEILE ---
const finder = components.get(OBC.ItemsFinder);

// Filterregeln für Wände, Türen, Fenster und Sonstiges definieren
finder.create("Wände", [{ categories: [/WALL/i] }]);
finder.create("Türen", [{ categories: [/DOOR/i] }]);
finder.create("Fenster", [{ categories: [/WINDOW/i] }]);
finder.create("Andere Bauteile", [{ 
  categories: [/SLAB/i, /ROOF/i, /FURNISHING/i, /PROXY/i, /MEMBER/i] 
}]);

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
  
  // --- 修复点：使用 .list 并遍历其中的模型对象 ---
  // 在你的版本里，fragments.list 存储了所有加载的模型组
  fragments.list.forEach((model: any) => {
    // 只有当对象有其 3D 表示（object 或 mesh）时才计算
    if (model.object) {
      sceneBounds.expandByObject(model.object);
    } else if (model.mesh) {
      sceneBounds.expandByObject(model.mesh);
    }
  });

  // 如果没有模型，则退而求其次使用全场景（包括地图）
  if (sceneBounds.isEmpty()) {
    sceneBounds.setFromObject(world.scene.three);
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  sceneBounds.getCenter(center);
  sceneBounds.getSize(size);

  // 这里的 distance 现在是根据“建筑”大小计算的，不会被 750 宽的地图撑大
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
    // 关键修正：BUI Checkbox 的 value 本身就是 boolean
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
              await loadIfc("final_model.ifc");
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


