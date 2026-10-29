# מסמך 1: ה-POC לפני ה-branch (clustering של נקודות)

המסמך מתאר את הפרויקט כפי שהוא ב-`main`, ב-commit `1bcb4fb` ("sharp sprite"), לפני ה-branch `feature/shape-clustering`.
חלק מהקבצים השתנו ב-branch (בעיקר ה-worker וה-client שלו). את השינויים האלה מתאר [מסמך 2](02-shape-clustering.md).

---

## 1. מה הפרויקט עושה

זה POC שבודק איך מציגים **כמות גדולה מאוד של features** על גלובוס תלת-ממדי של **CesiumJS**, בלי שהדפדפן ייתקע.

- נוצרות 100,000 נקודות אקראיות בתוך ה-bbox של ישראל (`[34.25, 29.45, 35.90, 33.35]`).
- נקודות קרובות מאוחדות ל-**cluster**, ומוצגות כבועה עם מספר. ככל שמתקרבים, הבועות מתפרקות לבועות קטנות יותר ובסוף לנקודות בודדות.
- כל החישוב הכבד (בניית ה-index ושאילתות) רץ ב-**Web Worker**, כך שה-UI נשאר חלק.
- הציור מתבצע **לפי אריחים (tiles)**: מבקשים מה-worker רק את האריחים שנראים כרגע, ומציירים רק אותם.

בפרויקט קיים גם ניסוי שני, **vector tiles** (פישוט והצגה של קווים ופוליגונים עם `geojson-vt`). הניסוי הזה **מכובה** ב-`main.ts` (ראו סעיף 9).

---

## 2. איך מריצים

דרישות: Node.js וגישה ל-npm registry.

```bash
npm install        # התקנת תלויות
npm run dev        # שרת פיתוח של Vite על http://localhost:5173
npm run build      # build ל-production לתיקייה dist/
npm run preview    # הרצה מקומית של ה-build
```

מה רואים אחרי שהדף עולה:

1. המצלמה "עפה" אל ה-bbox של ישראל (בערך 1.5 שניות).
2. אחרי שה-worker מסיים לבנות את ה-index, מופיעות בועות.
3. בפינה השמאלית העליונה יש **HUD** עם מספר הבועות, מספר הנקודות הבודדות ורמת הזום הנוכחית.
4. בצד ימין, מתחת לסרגל הכלים של Cesium, יש כפתורי זום `+` ו-`−`.
5. לחיצה על בועה מדפיסה ל-console את ה-features שבתוכה. לחיצה על נקודה בודדת מדפיסה את ה-feature שלה.

הערות:

- **מפת הבסיס היא OpenStreetMap.** שכבת הבסיס של Cesium כברירת מחדל (Bing דרך Cesium ion) דורשת ion token, ובלעדיו הגלובוס שחור.
- `vite.config.ts` מעתיק את הקבצים הסטטיים של Cesium ל-`/cesium` (בעזרת `vite-plugin-static-copy`) ומגדיר `CESIUM_BASE_URL`. בלי זה Cesium לא מוצא את ה-workers וה-assets שלו.
- ב-`main.ts` יש top-level `await`, ולכן ב-`vite.config.ts` מוגדר `build.target: "esnext"`. בלי ההגדרה הזו ה-build נכשל.

---

## 3. מבנה הקוד

| קובץ | אחריות |
|---|---|
| `index.html` | הדף: הקונטיינר של Cesium, ה-HUD וכפתורי הזום |
| `src/main.ts` | נקודת הכניסה: יוצר את ה-`Viewer`, מייצר את הנתונים, מחבר את ה-worker, המצלמה וה-renderer |
| `src/map-constants.ts` | קבועים משותפים ל-main thread ול-worker (בלי import של Cesium!) |
| `src/data.ts` | יצירת נתונים אקראיים (`@turf/random`) ו-`buildFeatureIndex` (מפה של `id` ל-feature) |
| `src/cluster-worker.ts` | ה-Web Worker: מחזיק את ה-index של `Supercluster` (ואת `geojson-vt` של הניסוי המכובה) |
| `src/cluster-worker-client.ts` | עוטף את `postMessage` ומפיץ את התשובות של ה-worker ל-listeners |
| `src/camera-handler.ts` | מזהה שינוי במצלמה, מחשב bbox ו-zoom, וקורא ל-renderer |
| `src/rendering/tile-renderer.ts` | ה-renderer הפעיל: מבקש אריחים, מנהל את המצב שלהם ומצייר |
| `src/rendering/base-renderer.ts` | בסיס משותף: ה-`BillboardCollection` (בועות), ה-`PointPrimitiveCollection` (נקודות), ציור feature ועדכון HUD |
| `src/rendering/cluster-renderer.ts` | renderer ישן שמבקש clusters לכל ה-bbox בבת אחת (לא מחובר; נמחק ב-branch) |
| `src/sprite-cache.ts` | יצירת תמונת הבועה (canvas) עם cache, גודל וצבע לפי כמות |
| `src/picking.ts` | לחיצה על המפה (`drillPick`) והדפסת התוכן |
| `src/zoom-controls.ts` | כפתורי הזום |
| `src/rendering/vector-layer-renderer.ts`, `tile-utils.ts` | הניסוי של vector tiles (מכובה) |
| `src/global.d.ts` | טיפוסים משותפים: `BBox`, `WorkerRequest`, `WorkerResponse` |

---

## 4. ארכיטקטורה

```
 main thread                                             Web Worker
 ───────────                                             ──────────
 main.ts
   │  buildRandomPointFeatures(100k)
   │  client.build(points, options) ──── postMessage ──►  new Supercluster(...).load(points)
   │                                 ◄── "built" ───────
   │
 CameraHandler (בדיקה בכל frame)
   │  bbox + zoom השתנו?
   ▼
 TileRenderer.requestRenderByBboxAndZoom(bbox, zoom)
   │  computeCoveringTiles → אריחים חדשים בלבד
   │  client.tile(z, x, y) ──────────── postMessage ──►  index.getTile(z, x, y)
   │                                 ◄── "tile" ────────  { features (קואורדינטות בתוך האריח) }
   ▼
 TileRenderer.drawTile → processTileFeatures
   │  cluster → Billboard (sprite עם מספר)
   │  single  → PointPrimitive
   ▼
 viewer.scene.requestRender()
```

---

## 5. ה-flow צעד אחרי צעד

### 5.1 עלייה (startup)

1. `main.ts` יוצר `Viewer` עם הגדרות ביצועים: בלי timeline, בלי animation, בלי geocoder, ועם OSM כמפת בסיס.
2. מופעל `requestRenderMode = true`: Cesium מצייר frame רק כשמבקשים, ולא 60 פעמים בשנייה (ראו 6.7).
3. המצלמה עפה אל ה-bbox (`flyToBbox`, עם `await`).
4. נוצרות 100k נקודות (`buildRandomPointFeatures`). לכל אחת `id` ייחודי (UUID).
5. נוצר ה-Worker, ונשלחת אליו הודעת `build` עם הנקודות וה-options.
6. כשה-worker עונה `built`, ה-`CameraHandler` מבצע את הציור הראשון (`renderForFirstTime`).

### 5.2 זיהוי שינוי במצלמה (`CameraHandler`)

- בכל frame (על האירוע `scene.preUpdate`, שרץ בכל animation frame גם ב-`requestRenderMode`), משווים את ה-`camera.viewMatrix` ואת גודל ה-canvas ל-frame הקודם.
- אם משהו השתנה, ה-view מסומן כ-dirty. רענון מתבצע **לכל היותר פעם ב-100ms** (`THROTTLE_MS`). כך המיקום הסופי נקלט לכל היותר 100ms אחרי שהמצלמה נעצרת.
- מחשבים את ה-bbox (`computeViewRectangle`) ואת ה-zoom. אם שניהם זהים לפעם הקודמת, לא עושים כלום.
- **חישוב ה-zoom:** `zoom = floor(log2(WORLD_METERS / (TILE_SIZE_PX * metersPerPixel)))`. זו רמת הזום שבה אריח מוצג בגודל 256px לפחות על המסך. ראו 6.3.
- גם view שחוצה את קו האורך 180 (antimeridian, `west > east`) מטופל.

### 5.3 בקשת אריחים (`TileRenderer.requestRenderByBboxAndZoom`)

1. `computeCoveringTiles(bbox, zoom)` מחשב את כל האריחים שמכסים את ה-bbox. ה-latitude נחתך בגבול של web-mercator (85.05°), ומספרי האריחים נחתכים לטווח החוקי. view שחוצה את ה-antimeridian מטופל.
2. כל אריח שעוד אין לו מצב מקבל מצב `pending`, ונשלחת בקשה ל-worker (`client.tile(z, x, y)`).
3. `cleanupOldTiles` מטפל באריחים שיצאו מה-view:
   - אריח `pending` שיצא מה-view: המצב שלו נמחק. כשהתשובה תגיע היא תידחה, ואם האריח יחזור ל-view הוא יתבקש מחדש.
   - אריח `ready` שיצא מה-view: הוא עובר ל-**stale** ונשאר על המסך עד שכל האריחים החדשים מוכנים, ורק אז נמחק. כך אין "הבהוב ריק" בזמן זום או הזזה.

### 5.4 ציור אריח (`drawTile` / `processTileFeatures`)

1. תשובה מתקבלת רק אם האריח עדיין במצב `pending`. כך נדחות תשובות כפולות ותשובות לאריחים שבוטלו.
2. לכל feature באריח:
   - **סינון buffer:** `Supercluster` מחזיר גם features מאריחים שכנים (buffer). מציירים רק features שהקואורדינטות שלהם בתוך `[0, extent)`, כלומר שייכים לאריח הזה. בלי הסינון, בועות ליד גבולות של אריחים היו מצוירות פעמיים.
   - הקואורדינטות בתוך האריח מומרות ל-lon/lat ואחר כך ל-`Cartesian3`.
   - **cluster** → `Billboard` עם sprite (עיגול צבעוני עם המספר).
   - **single** → `PointPrimitive` בגודל 6px.
3. גם אריח ריק מסומן `ready`, כדי שלא יתבקש שוב בכל תזוזה.
4. מעדכנים את ה-HUD וקוראים ל-`scene.requestRender()`.

### 5.5 לחיצה (`picking.ts`)

- `scene.drillPick` מחזיר את כל מה שמתחת לעכבר (עד 64 אובייקטים).
- לכל billboard או נקודה יש `id` שהוא אובייקט `{ kind: "cluster" | "point", id, ... }`.
- נקודה בודדת: ה-feature נמצא ב-`byId` ומודפס.
- בועה: נשלחת בקשת `leaves(cluster_id)` ל-worker, והתשובה מודפסת ל-console.

---

## 6. החלטות טכניות והסבר

### 6.1 למה Web Worker
בניית index ל-100k נקודות לוקחת בערך שנייה. אם היא הייתה רצה ב-main thread, הדף היה קופא. ה-worker מקבל את הנתונים פעם אחת, בונה את ה-index, ואחר כך עונה על שאילתות קטנות (אריח אחד בכל פעם).

### 6.2 למה Supercluster ולמה לפי אריחים
- `Supercluster` (של Mapbox) בונה היררכיה של clusters לכל רמת זום מראש (KD-tree לכל רמה), כך ששאילתה היא מהירה מאוד.
- **לפי אריחים, ולא bbox שלם:** כשהמשתמש מזיז את המפה, רק אריחים חדשים נכנסים ל-view. מבקשים ומציירים רק אותם, ולא את הכול מחדש. `ClusterRenderer` הישן עבד עם bbox שלם וצייר הכול מחדש בכל תזוזה.

### 6.3 חישוב ה-zoom: `TILE_SIZE_PX` ו-`floor`
- `TILE_SIZE_PX = 256` הוא הגודל ה"נומינלי" של אריח על המסך, כמו במפות web רגילות.
- משתמשים ב-`floor` ולא ב-`round`, כדי שאריח יוצג תמיד בגודל **בין 256 ל-512 פיקסלים**. כך המרחק על המסך בין בועות הוא לפחות ה-radius, והן לא חופפות.

### 6.4 `radius` בפיקסלים של המסך, ו-`EXTENT`
- `Supercluster` מודד את ה-`radius` ביחידות של `extent`, ולא בפיקסלים.
- `EXTENT = 4096` הוא רק רזולוציית הקואורדינטות בתוך אריח (דיוק של 1/16 פיקסל). הוא **לא** משפיע על מה שרואים.
- ה-worker ממיר: `radius = radiusPx * EXTENT / TILE_SIZE_PX`.
- **היסטוריה חשובה:** בהתחלה הוגדר `radius: 40` בלי המרה. עם `extent: 4096` זה יצא בערך 2.5 פיקסלים בלבד, ולכן כמעט שום דבר לא התאחד והבועות נערמו אחת על השנייה.

### 6.5 גודל הבועות וה-`CLUSTER_RADIUS_PX`
ב-`map-constants.ts`:

| קבוע | ערך | משמעות |
|---|---|---|
| `SPRITE_MIN_RADIUS_PX` | 12 | רדיוס בועה של 2 נקודות |
| `SPRITE_MAX_RADIUS_PX` | 28 | רדיוס בועה של `SPRITE_MAX_COUNT` נקודות ומעלה |
| `SPRITE_MAX_COUNT` | 200 | מעל הכמות הזו הבועה לא גדלה |
| `SPRITE_PAD_PX` | 2 | מקום לקו הלבן סביב העיגול |
| `CLUSTER_GAP_PX` | 4 | רווח נוסף בין הבועות הגדולות ביותר |
| `CLUSTER_RADIUS_PX` | `2 * (28 + 2) + 4 = 64` | **מחושב**, לא נקבע ידנית |

הרעיון: בועות לא נוגעות זו בזו כשה-radius גדול לפחות כמו הקוטר של הבועה הגדולה ביותר. לכן `CLUSTER_RADIUS_PX` נגזר מגודל ה-sprite.
אם מגדילים את הבועות, ה-radius גדל, ומתקבלים פחות clusters וגסים יותר.

### 6.6 בועות חדות (sprite)
הבעיה הייתה טשטוש בגלל resampling כפול. מה נעשה:

- `useBrowserRecommendedResolution: false` ב-`Viewer`: Cesium מצייר ברזולוציה של המכשיר. בברירת המחדל הוא מצייר ברזולוציית CSS, והדפדפן מגדיל את ה-canvas במסכים עם scaling של 125%/150%.
- גודל של billboard ב-Cesium נמדד ב-**drawing-buffer pixels**, ו-Cesium **לא** מכפיל אותו ב-pixel ratio. לכן ה-sprite מצויר בדיוק בגודל של `cssSize * pixelRatio`, וזה גם ה-`width`/`height` של ה-billboard: פיקסל אחד של תמונה על פיקסל אחד של מסך.
- `PointPrimitive` דווקא **כן** מוכפל ב-pixel ratio על ידי Cesium (`czm_pixelRatio` ב-shader). לכן `pixelSize: 6` נשאר בפיקסלי CSS.
- `scene.pixelRatio` הוא private ב-typings של Cesium. לכן `BaseRenderer.drawingBufferPixelRatio()` מחשב אותו לבד, באותה נוסחה.
- **מחיר:** פי `devicePixelRatio²` יותר פיקסלים לצייר. אם ה-GPU חלש, אפשר להגדיר `viewer.resolutionScale < 1`.

### 6.7 `requestRenderMode` ובדיקת מצלמה בכל frame
- `requestRenderMode = true` חוסך GPU: frame מצויר רק כשמשהו השתנה. לכן כל שינוי שאנחנו עושים ב-primitives מלווה ב-`scene.requestRender()`.
- זיהוי המצלמה נעשה בהשוואת `viewMatrix` בכל frame, ולא עם האירועים `camera.changed` / `moveEnd`, משתי סיבות:
  - `changed` נורה רק אחרי שינוי של `percentageChanged` (50% כברירת מחדל, יחסית לגובה **החדש**). למשל zoom-out בכפתור לא מפעיל אותו.
  - `moveEnd` נורה רק 500ms אחרי שהמצלמה עוצרת.
- היתרון: **כל** תזוזה נקלטת, בין אם בעכבר, ב-`flyTo`, ב-`zoomIn` או ב-`setView`, **בלי** לקרוא ל-refresh ידנית מכל מקום בקוד.

### 6.8 Texture atlas: `billboard.setImage(id, canvas)`
אם מעבירים canvas כ-`image`, Cesium יוצר לו GUID חדש וכניסה חדשה ב-texture atlas **לכל billboard**, גם כשה-canvas זהה. לכן משתמשים ב-`setImage` עם `id` קבוע (`clusterSpriteId`), וכל הבועות הזהות חולקות כניסה אחת.

### 6.9 `BillboardCollection` / `PointPrimitiveCollection` ולא Entities
ה-Entity API של Cesium נוח, אבל כבד מאוד לעשרות אלפי אובייקטים. Primitives (collections) זולים בהרבה.

### 6.10 OpenStreetMap כמפת בסיס
חינמי ולא דורש token, אבל **מיועד לשימוש קל בלבד** ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).
**ב-production חובה להחליף** לשרת אריחים משלכם או לספק מסחרי.

---

## 7. דברים חשובים שצריך לדעת

1. **ה-cache שב-`TileRenderer` (מוער) לא שמיש.** הוא מוסיף מחדש billboards שכבר נהרסו (`remove()` קורא ל-`_destroy()`), ושומר את האובייקטים הלא נכונים. הפתרון המומלץ: collection נפרד לכל אריח, הסתרה (`show = false`) במקום מחיקה, ו-LRU. ראו `docs/cluster-flow.md`, Known issues #1.
2. **מצלמה מוטה (tilt) מבקשת יותר מדי אריחים.** כשהמצלמה מוטה ורואים את האופק, ה-bbox ענק ועלולים להתבקש מאות אריחים. הפתרון המומלץ הוא בחירת אריחים לפי גודל על המסך (quadtree LOD, כמו שעושה הגלובוס של Cesium). ראו Known issue #2.
3. **`remove()` על collection גדול יקר:** הוא גורם לבנייה מחדש של כל ה-vertex buffers. גם כאן הפתרון הוא collection לכל אריח.
4. **sprites ייחודיים לא מוגבלים:** כל מספר מתחת ל-1000 יוצר sprite חדש, וה-atlas וה-cache לא מתנקים אף פעם. אפשר לקבץ את התוויות ("10+", "100+") או לצייר את המספר בנפרד.
5. **לוגים לדיבוג:** `TileRenderer` מדפיס ל-console בכל תזוזה. יש להסיר אותם או לשים אותם מאחורי flag לפני production.
6. **הנתונים נוצרים ב-main thread** ונשלחים ל-worker עם `postMessage` (העתקה מלאה). עם נתונים אמיתיים עדיף לטעון אותם ישירות בתוך ה-worker.
7. **`map-constants.ts` אסור שיכיל import של Cesium,** כי גם ה-worker טוען אותו.
8. **Line endings:** ה-repo שומר קבצים עם LF. ב-Windows כדאי לבדוק ש-`git diff --stat` לא מראה שינוי של קובץ שלם.

---

## 8. עצות ביצועים (בקצרה)

הרשימה המלאה, לפי סדר השפעה, נמצאת ב-`docs/cluster-flow.md` ("Performance advice"). העיקר:

1. collection נפרד לכל אריח (מאפשר גם cache).
2. הגבלת מספר ה-sprites הייחודיים.
3. העברת typed arrays (`Float64Array`) מה-worker כ-transferable, עם המיקומים כבר מחושבים.
4. בחירת אריחים לפי גודל על המסך.
5. פיזור עבודת הציור על פני כמה frames.
6. נקודות בודדות עם `BlendOption.OPAQUE`.

למדידה: `viewer.scene.debugShowFramesPerSecond = true` ו-Performance panel של Chrome.

---

## 9. הניסוי של vector tiles (מכובה)

- `geojson-vt` חותך ומפשט קווים ופוליגונים לאריחים בתוך ה-worker, ו-`VectorLayerRenderer` מצייר אותם כ-Entities.
- כדי להפעיל אותו, מחליפים ב-`main.ts` את השורות המסומנות `// Vector tiles flow:`.
- הבעיות הידועות שלו (Entity API שלא מחזיק כמויות, features שנחתכים לכמה אריחים, MultiPolygon ועוד) מתועדות ב-`docs/vector-tiles-flow.md`.
- ה-branch `feature/shape-clustering` פותר את הצורך הזה בדרך אחרת (מסמך 2).
