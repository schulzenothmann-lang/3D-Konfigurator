# 3D-Konfigurator Learnings & Technische Dokumentation

## Projektstruktur

```
3D-Konfigurator/
├── index.html          — Haupt-Konfigurator (alle UI-Logik inline)
├── models.html         — Modell-Auswahl-Seite
├── js/
│   └── preview3d.js    — Three.js 3D-Viewer (ES-Modul)
├── models/
│   └── sms-5000.glb    — Tripo3D-generiertes GLB-Modell (5.2 MB)
├── public/             — Statische Assets (Bilder etc.)
├── vercel.json         — Vercel: outputDirectory: "." (wichtig!)
└── img/                — Bilder für UI
```

---

## GLB-Modell: SMS-5000

### Struktur
- **91 Meshes** alle unter ROOT-Node (flache Hierarchie, keine Gruppen)
- **4 Infill-Panels**: `Window_Infill_Medium_Left/Right`, `Window_Infill_Small_Left/Right`
- **Alle Materialien**: `Material_tripo_part_N` — eigene Material-Instanz pro Mesh
- **Tripo3D PBR-Problem**: ALLE Materialien haben `metalness=1.0, roughness=1.0` → rendert spiegelartig silbern, obwohl der reale Anhänger schwarz/dunkel ist

### Identifizierte Key-Meshes (SMS-5000)

| Mesh | Verts | Material | Rolle |
|------|-------|----------|-------|
| `tripo_part_0` | 2154 | `Material_tripo_part_0` | **HAUPTPANEL** (große sichtbare Seitenfläche) |
| `tripo_part_24` | 758 | `Material_tripo_part_24` | **RAHMEN/TRIM** (Rahmen um das Hauptpanel) |
| `tripo_part_7` | 1767 | `Material_tripo_part_7` | Rad (Felge/Reifen) |
| `tripo_part_4` | 1712 | `Material_tripo_part_4` | Rad-Komponente |
| `tripo_part_6` | 1165 | `Material_tripo_part_6` | Rad-Komponente |
| `tripo_part_2` | 777 | `Material_tripo_part_2` | Felge links |
| `tripo_part_8` | 753 | `Material_tripo_part_8` | Felge rechts |

**Wichtig**: Beide `tripo_part_0` UND `tripo_part_24` müssen in `BODY_MATERIAL_NAMES` erfasst werden, um die vollständige Karosserie zu färben!

### Identifikations-Methode für neue Modelle

1. **`_debugAllMats()`** in `preview3d.js` → gibt alle Materialien nach Vertex-Count sortiert aus
2. **`_debugSetMat(matName, '#ff6600')`** → testet ein Material mit Bright-Orange bei `metalness=0`
3. **Problem**: Materialien mit dunkler Textur + `metalness=0` können orange kaum zeigen → stattdessen Materialien mit `metalness=1` und Farbänderung testen, oder das gesamte Modell auf schwarz setzen und gezielt ein Material auf weiß → dann sieht man das helle Mesh
4. **Zuverlässigste Methode**: Material auf Weiß setzen AND dabei Metalness auf 0 lassen → wenn das Material dadurch DUNKLER wird (weil es vorher von metalness=1 profitiert hatte), ist es gefunden

### Wichtige Learnings zur Mesh-Identifikation

1. **Blender-Import ≠ Three.js-Visualisierung**: Immer direkt in Three.js per `scene.traverse()` testen!

2. **Vertex-Count ist kein Indikator für Typ**: Bei SMS-5000 hat `tripo_part_0` (2154 verts) die meisten Vertices und IST die große sichtbare Seitenfläche.

3. **Dunkle Texturen erschweren Debug**: `_debugSetMat` mit Orange macht Materialien mit dunkler Textur kaum sichtbar — besser mit Weiß testen UND prüfen ob sich der visuelle Gesamteindruck ändert.

4. **Material-Namen folgen Node-Namen**: In Tripo3D-GLBs: `node_name = tripo_part_N` → `material_name = Material_tripo_part_N`.

---

## Three.js Material-System (PBR)

### Das Metalness-Problem
Tripo3D-Modelle exportieren alle Materialien mit:
```
metalness = 1.0   ← macht das Material zum perfekten Spiegel
roughness = 1.0   ← diffuse Reflexion, aber metalness=1 dominiert
```
Resultat: Das Modell erscheint silbern/verspiegelt, egal was die Texture-Farbe ist.

### FINALE Lösung: Textur-basiertes Einfärben

**Kernprinzip**: Albedo-Textur (`mat.map`) BEHALTEN — sie enthält die Texturdetails (Panel-Linien, Körnung, Materialstruktur). Nur `metalnessMap` und `roughnessMap` entfernen (um Tripo3D-Artefakt zu überschreiben), und `mat.color` als Tint-Multiplikator auf die Textur anwenden.

```javascript
// RICHTIG: Textur behalten, PBR-Maps null, nur Farbe ändern
mat.color.set(hex);         // ← Tint-Multiplikator: final = texture × color
mat.map = origMap;          // ← BEHALTEN! Texturdetail bleibt
mat.metalnessMap = null;    // ← KRITISCH: Tripo3D metalnessMap würde metalness=1 erzwingen
mat.roughnessMap = null;    // ← KRITISCH: roughnessMap überschreibt roughness-Skalar
mat.metalness = pbr.metalness;
mat.roughness = pbr.roughness;

// FALSCH (alte Methode): Textur entfernen → flacher, plastischer Look
mat.map = null;             // ← Verliert Texturdetail, sieht billig aus
```

**Warum `mat.map = null` falsch ist**: Ohne Textur wirkt das Material wie Plastik/Gummi. Mit Textur bleiben Oberflächen-Charakter und Panel-Details erhalten.

### PBR-Parameter nach Luminanz (FINALES Setup)

```javascript
function pbrForHex(hex) {
  const c = new THREE.Color(hex);
  const lum = 0.2126*c.r + 0.7152*c.g + 0.0722*c.b;
  if (lum > 0.88) return { metalness: 0.50, roughness: 0.30 }; // sehr hell/weiß → glänzend
  if (lum < 0.08) return { metalness: 0.00, roughness: 0.88 }; // dunkel/schwarz → matt
  return               { metalness: 0.10, roughness: 0.65 };   // alle anderen  → Satin
}
```

### Beleuchtung (optimiert für Farbkonfigurator)

```javascript
scene.add(new THREE.AmbientLight(0xffffff, 0.7));    // ← erhöht auf 0.7 (von 0.5)
key   = new THREE.DirectionalLight(0xffffff, 1.6);   // ← reduziert von 3.0 (weniger Specular-Blowout)
fill  = new THREE.DirectionalLight(0xcce0ff, 0.9);   // ← reduziert von 1.2
rim   = new THREE.DirectionalLight(0xffffff, 0.5);   // ← reduziert von 0.8
```

**Warum reduzieren?** Ein Key-Light bei 3.0 erzeugt auf Satin-Materialien (roughness=0.75) einen blendenden weißen Specular-Fleck, der die Körperfarbe überstrahlt.

---

## Doppel-Lade-Bug (kritisch!)

### Problem
In `index.html` gab es zwei Event-Listener, die beide `syncPreview3d()` aufriefen:
```javascript
window.addEventListener('preview3d-ready', syncPreview3d, { once: true });
window.addEventListener('load', () => {
  if (window.preview3d) syncPreview3d(); // ← auch dieser feuert!
});
```

### Folge
Das Modell wird **zweimal** geladen. Der zweite Ladevorgang ersetzt die Scene, aber `bodyMeshData` enthält Material-Referenzen aus dem ersten Ladevorgang → `setColor()` ändert unsichtbare (bereits entfernte) Materialien.

### Fix
```javascript
let _preview3dSynced = false;
function _onceSyncPreview3d() {
  if (_preview3dSynced) return;
  _preview3dSynced = true;
  syncPreview3d();
}
window.addEventListener('preview3d-ready', _onceSyncPreview3d, { once: true });
window.addEventListener('load', () => {
  if (window.preview3d) _onceSyncPreview3d();
});
```

---

## "Schwarz Matt" = Echter Matt-Schwarz-Look

Das Original-Tripo3D-Modell rendert SILBERN (metalness=1.0 Artefakt), obwohl der reale SMS-5000 Schwarz Matt ist. Daher: Schwarz Matt wird als **echter schwarzer Paint-Auftrag** implementiert, nicht als "original"-Restore.

**Implementierung**: `selectColor('black')` → `preview3d.setColor('#111111')` → `pbrForHex('#111111')` → `metalness=0.05, roughness=0.88` → echter Matt-Schwarz-Look.

**Warum nicht 'original'?** Das originale Tripo3D-Modell mit metalness=1.0 sieht silbern aus — das passt nicht zu "Schwarz Matt". Echter Paint-Auftrag sieht besser aus.

### Initialfarbe beim Laden

`syncPreview3d()` ruft `preview3d.setColor(colorHexFor3d(S.color))` **VOR** `preview3d.load()` auf. Da `load()` asynchron ist, speichert `preview3d.js` die `currentColor`, und wendet sie am Ende der GLB-Lade-Callback automatisch an (`if (currentColor !== 'original') applyColorNow(currentColor)`).

### Farb-Mapping-Funktion

```javascript
function colorHexFor3d(colorId) {
  return COLORS.find(c => c.id === colorId).hex;
}
```

Alle Farben werden als Hex übergeben. Nur der Sonderfall `'original'` (bei setColor) restauriert die Original-Texturen.

### PBR-Parameter nach Luminanz

```javascript
function pbrForHex(hex) {
  const lum = luminance(hex);
  if (lum > 0.65) return { metalness: 0.65, roughness: 0.30 }; // silber/weiß → metallic
  if (lum < 0.08) return { metalness: 0.05, roughness: 0.88 }; // schwarz/dunkel → matt
  return              { metalness: 0.18, roughness: 0.42 };     // farben → satin
}
```

Diese Funktion sorgt dafür, dass dunkle Farben wirklich matt aussehen und helle Farben metallic glänzen.

---

## Vercel-Deployment

### Problem
Vercel erkennt `public/`-Ordner automatisch und serviert NUR diesen → alle anderen HTML/JS-Dateien sind nicht erreichbar (404).

### Fix
`vercel.json` mit `outputDirectory: "."` anlegen:
```json
{
  "outputDirectory": "."
}
```

### Deploy-Befehl
```bash
# Beim ersten Deployment (wegen Sonderzeichen im Ordnernamen):
vercel deploy --prod --name mino-konfigurator

# Nachfolgende Deployments:
cd "3D-Konfigurator" && vercel deploy --prod
```

**Live URL**: https://mino-konfigurator.vercel.app

---

## Workflow: Neues 3D-Modell integrieren

1. **GLB exportieren** in `models/<model-id>.glb`
2. **MODEL_MAP** in `index.html` eintragen:
   ```javascript
   'model-id': { glb: 'models/model-id.glb' }
   ```
3. **Karosserie-Material identifizieren** (in Three.js, nicht Blender):
   - Debug-Funktion `_debugForceRed()` auf alle Meshes anwenden
   - Einzelne Meshes per `scene.traverse` einfärben und Screenshot vergleichen
   - Das richtige Mesh ist das, das sich bei direkter Material-Änderung visuell ändert
4. **`BODY_MATERIAL_NAME`** in `preview3d.js` auf korrekten Material-Namen setzen
5. **Testen**: setColor() mit verschiedenen Farben und 'original' testen
6. **Deployen**: `vercel deploy --prod`
7. **iCloud-Sync**: Dateien nach `/Library/Mobile Documents/.../Konfigurator /` kopieren

---

## File: `preview3d.js` — Public API

```javascript
window.preview3d = {
  load(url)              // GLB laden (URL relativ zur Domain)
  setColor(hexOrOriginal) // Farbe setzen oder 'original' für Original-Zustand
  setWindowVariant(v)    // 'large' | 'medium' | 'small'
  setView(name)          // 'side' | 'rear' | 'open'
  dispose()              // Three.js aufräumen
}
```

## Debugging-Tipps

```javascript
// Im Browser-Console:
// Alle Materialien rot einfärben (Test ob Rendering funktioniert):
scene.traverse(c => { if(c.isMesh) { c.material.color.set(0xff0000); c.material.metalness=0.1; c.material.needsUpdate=true; }});

// Spezifisches Mesh einfärben:
scene.traverse(c => { if(c.name === 'tripo_part_24') { c.material.color.set(0xff0000); c.material.needsUpdate=true; }});

// Material-Namen aller Meshes ausgeben:
const info=[]; scene.traverse(c=>{if(c.isMesh){const m=Array.isArray(c.material)?c.material:[c.material];m.forEach(mat=>info.push(c.name+'→'+mat.name+' ('+c.geometry.attributes.position.count+' verts)'));}}); console.log(info.join('\n'));
```
