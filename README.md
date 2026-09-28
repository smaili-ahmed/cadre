# Logo Center

Application web pour centrer automatiquement un groupe de logos sur une image, puis l’exporter.

Tout se passe **dans le navigateur** : aucune donnée n’est envoyée sur un serveur.

## Fonctionnalités

- Import d’une image de fond (PNG, JPG, JPEG, WEBP) par bouton ou glisser-déposer.
- Ajout de 2 ou 3 logos (PNG, JPG, JPEG, WEBP, SVG), transparence conservée.
- **Centrage mathématique du groupe** : le groupe est traité comme un bloc unique, jamais
  logo par logo. Marges gauche/droite et haut/bas strictement égales.
- **Une seule échelle automatique** partagée par tous les logos : chaque logo garde son ratio
  largeur/hauteur, et tous les logos sont réduits du même facteur.
- Espacement réglable de 0 à 300 px, exprimé en pixels de l’image d’origine.
- Alignement intelligent : `Centre H + V`, `horizontal`, `vertical`, `alignement horizontal`,
  `alignement vertical`.
- Ajustements fins : bord gauche / droit / haut / bas, distribution horizontale, pas à pas de 1 px.
- Déplacement et redimensionnement à la souris (ratio jamais déformé, redimensionnement autour
  du centre), zoom à la molette et au pincement, ajustement à l’écran.
- Aimant optionnel, grille, repères de centrage, annuler / rétablir.
- Export **PNG ou JPG à la résolution d’origine**, sans interface, sans repères, sans grille.

## Démarrage

```bash
npm install
npm run dev      # http://localhost:5173
```

## Vérification

```bash
npm run build        # tsc -b + vite build
npm run lint         # oxlint
npm run test:unit    # tests de centrage (headless, sans navigateur)
npm run test:e2e     # build + test navigateur Puppeteer avec analyse des pixels
npm test             # tout
```

Le test navigateur utilise les fixtures de `scripts/fixtures/` (des fonds noirs 1920×1080,
2048×2048 et 4000×3000, des wordmarks blancs et un logo à fines rayures de 2 px) et **analyse les
pixels réellement exportés** : position du groupe, espacements, ratios, présence ou absence de
repères, résolution et netteté. Les captures sont écrites dans `scripts/screenshots/`.

Les fixtures sont régénérables : `npm run fixtures`.

## Haute résolution de l’export

**L’export ne passe plus par Fabric.** Le canvas de prévisualisation ne sert qu’à l’aperçu : au
moment du téléchargement, un canvas **neuf** est créé aux dimensions exactes de l’image importée et
la scène y est reconstruite depuis les sources originales :

```
exportCanvas.width  = largeurDemandee          // originalWidth par défaut
exportCanvas.height = hauteurDerivée           // ratio de l’image toujours préservé
ctx.imageSmoothingEnabled = true
ctx.imageSmoothingQuality = 'high'
ctx.drawImage(imageOriginale, 0, 0, exportCanvas.width, exportCanvas.height)
ctx.drawImage(logoOriginal,   box.left * k, box.top * k, box.width * k, box.height * k)
```

Conséquences : la taille du canvas affiché, le zoom, `devicePixelRatio`, la taille de l’écran et le
cache de rendu de Fabric n’ont **aucune** influence sur le fichier. L’export ne peut plus produire
une image réduite, puisqu’il ne lit plus le canvas de l’aperçu.

### Taille de sortie

Par défaut la sortie est **1:1**, c’est-à-dire la définition réelle de l’image importée. Un bouton
**Taille du fichier** permet de demander un fichier plus grand : boutons `Original`, `×2`, `×3`,
`×4`, ou une largeur libre en pixels. Le ratio de l’image est toujours conservé et l’ensemble de la
composition (fond **et** logos) est multiplié par le même facteur, donc la mise en page ne bouge pas.

Au-delà de `×1`, il s’agit d’un **agrandissement** : le fichier est plus lourd, mais il ne contient
pas plus de détail que la source. L’interface le signale explicitement. Pour un vrai gain de
définition, il faut une image source plus grande — aucun réglage du navigateur ne peut retrouver
des pixels qui ne sont pas dans le fichier d’origine.

### Coordonnées

L’éditeur stocke la géométrie des logos en **coordonnées image** (le zoom ne modifie que le
viewport Fabric, jamais les positions ni les tailles). La conversion demandée est donc l’identité
par construction :

```
scaleX = originalWidth / previewWidth = 1
scaleY = originalHeight / previewHeight = 1
exportX = previewX * scaleX = previewX
```

C’est ce qui garantit qu’un logo se retrouve exactement au même endroit dans l’image finale que dans
l’aperçu, quelle que soit la taille de la fenêtre.

### Sources

- L’image principale est relue depuis son data URL d’origine, et son `naturalWidth` est comparé à la
  taille enregistrée à l’import : une source remplacée est détectée.
- Chaque logo est relu depuis **son fichier original** (jamais une miniature) ; son
  `naturalWidth`/`naturalHeight` est vérifié avant dessin. Un SVG est exporté depuis sa source
  vectorielle, donc net à toute résolution.
- Les octets encodés sont ensuite **relus et leur taille vérifiée** (`readEncodedImageSize` : en-tête
  IHDR du PNG, marqueur SOF du JPEG). Si le navigateur plafonne silencieusement un canvas
  surdimensionné, l’export échoue avec un message explicite au lieu de télécharger un fichier plus
  petit.

PNG : sans perte, sans paramètre de qualité. JPG : qualité 1.0 par défaut (curseur 0.6–1), fond blanc
car le JPEG n’a pas de canal alpha.

### Vérification

Le test navigateur écrit les octets réellement téléchargés **sur disque** et les relit **depuis
Node**, sans navigateur : c’est la seule vérification que l’application ne peut pas falsifier.

| Image importée | Canvas affiché | Fichier sur disque | Logos | Netteté |
|---|---|---|---|---|
| 1920 × 1080 | 790 px | **1920 × 1080** | 604 / 546 px | rampe 1 px |
| 2048 × 2048 | 790 px | **2048 × 2048** | 646 / 584 px | rampe 1 px |
| 4000 × 3000 | 800 px | **4000 × 3000** | 1281 / 1159 px | rampe 0 px |
| 1920 × 1080 (fond détaillé) | 790 px | **1920 × 1080** | — | 1 px conservés |
| 2048 × 2048 en **DPR 2** | 1580 px | **2048 × 2048** | 646 / 584 px | — |
| 2048 × 2048 en **×2** | 790 px | **4096 × 4096** | 1291 / 1169 px | — |
| 2048 × 2048 en **largeur libre 1000** | 790 px | **1000 × 1000** | 620 / 561 px | — |

Le test de netteté est **calibré** : en forçant une miniature à 40 % à l’import, le logo à rayures
perd toutes ses transitions (198 → 0) et la rampe passe de 1 px à 206 px. La mesure est donc
reliable, pas décorative.

Contrôle complémentaire sur le fond détaillé : le fichier exporté a été comparé pixel par pixel à
l’image d’origine. Les 4 coins et le fond sont **identiques**, les différences sont confinées à la
zone des logos (`x 371..1554, y 427..651` sur 1920 × 1080) et le tramage 1 px du fond est intact
(198 transitions sur 200 px) : aucune trace de sous-échantillonnage.

## Choix techniques notables

- **Coordonnées en pixels de l’image.** Le zoom Fabric ne modifie que le viewport ; la géométrie
  des logos reste en coordonnées image, ce qui rend l’export et les tests déterministes.
- `strokeWidth: 0` sur les objets Fabric : la valeur par défaut `1` fausserait les dimensions.
- **Export indépendant du canvas de prévisualisation.** Voir la section précédente : c’est la
  garantie centrale de la qualité d’export.
- Un ancien correctif réinitialisait les `oCoords` de Fabric après l’export, parce que le aller-retour
  de viewport invalidait les caches de contrôle. Ce correctif n’est plus nécessaire : l’export ne
  touche plus au canvas vivant.
- **Historique.** Chaque action empile l’état *d’avant* la modification, capturé de façon
  synchrone : lire l’état après le changement, ou depuis un updater React, rendrait
  l’annulation inopérante. Les glissements deposent leur pas d’annulation au `mouse:down`.
- `React.StrictMode` est désactivé : le canvas est impératif et ne supporte pas le double montage.

## Structure

```
src/
  App.tsx                  état global, historique, raccourcis, export, mise en page
  components/
    CanvasEditor.tsx       canvas Fabric, objets, zoom, repères, aimant, échelle
    ImageUploader.tsx      import de l’image principale
    LogoUploader.tsx       ajout / liste / miniatures / ordre des logos
    LogoControls.tsx       modes, espacement, tailles, ajustements
    Toolbar.tsx            centrage, distribution, annuler, zoom, affichage
    ExportButton.tsx       export PNG / JPG
    ToastStack.tsx         messages utilisateur
  utils/
    centering.ts           maths du groupe : centre, alignement, distribution, échelle
    export.ts              rendu à résolution d’origine, blob, nom de fichier
    images.ts              validation, lecture, data URLs, dimensions SVG
    types.ts               types partagés
scripts/
  make-fixtures.ts         génération des images de test
  verify-centering.ts      tests unitaires du centrage
  e2e.ts                   test navigateur + analyse des pixels
```
