# מסמך 2: ה-branch `feature/shape-clustering`: polygons ו-polylines בתוך ה-clustering

המסמך מתאר מה ה-branch הוסיף על גבי ה-POC שבמסמך 1.
מסמכי מקור (באנגלית): ה-spec ב-`docs/superpowers/specs/2026-10-29-shape-clustering-design.md` והתוכנית ב-`docs/superpowers/plans/2026-10-29-shape-clustering.md`.

---

## 1. המטרה וההתנהגות

עד עכשיו רק **נקודות** השתתפו ב-clustering. ה-branch מוסיף **polygons** ו-**polylines** (`LineString`):

- **כשמסתכלים מרחוק**, כל shape מיוצג על ידי **נקודה** (anchor point). הנקודה הזו משתתפת ב-clustering יחד עם הנקודות הרגילות, והבועה מציגה את סך הכול.
- **כשמתקרבים**, ה-shape מוצג כ**גיאומטריה האמיתית** שלו, במקום הנקודה.
- **ההחלטה מתי לעבור לגיאומטריה תלויה בגודל של ה-shape על המסך,** ולא ברמת זום אחת לכולם. פוליגון ענק מוצג כגיאומטריה כבר מרחוק, ולא "נבלע" בתוך בועה כשהוא מכסה חצי מסך. פוליגון זעיר נשאר נקודה (וחלק מבועות) עד שמתקרבים מספיק.

**מה מבטיחים:**
- shape לעולם לא מצויר פעמיים, גם כשהוא חוצה כמה אריחים.
- המספרים בבועות נכונים בכל זום.
- כל בועה יודעת כמה נקודות, פוליגונים וקווים יש בה.

---

## 2. איך משתמשים

### 2.1 הרצה

כמו במסמך 1: `npm install`, ואז `npm run dev`. נתוני הדמו כוללים **60k נקודות, 30k פוליגונים ו-10k קווים** (`src/main.ts`).

מה רואים:
- בועות, ולצידן פוליגונים כתומים שקופים למחצה וקווים כחולים, ככל שהם גדולים מספיק על המסך.
- ב-HUD יש שלוש שורות:
  - `Clusters`: מספר הבועות.
  - `Singles (points + unrevealed shapes)`: מספר הנקודות הבודדות, **כולל** anchors של shapes שעוד לא נחשפו.
  - `Shapes (drawn)`: כמה shapes מצוירים כגיאומטריה כרגע.
- לחיצה על shape מדפיסה ל-console את ה-feature המקורי שלו. לחיצה על בועה מדפיסה את כל ה-features שבה, כולל shapes.

### 2.2 הזנת נתונים אמיתיים

ה-API נשאר פשוט:

```ts
client.build(features, { minPoints: 2, radiusPx: CLUSTER_RADIUS_PX, maxZoom });
```

- `features`: מערך של GeoJSON `Feature`, שכל אחד הוא `Point`, `Polygon` או `LineString`.
- **חשוב:** לכל feature צריך להיות `id` ייחודי. אם אין `id`, משתמשים באינדקס במערך (`String(index)`). אם מערבבים features עם `id` ובלי `id`, יכולה להיות התנגשות (ראו סעיף 9).
- גיאומטריות שלא נתמכות (`MultiPolygon`, `MultiLineString`, `GeometryCollection`) וגיאומטריות ריקות **מדולגות**. ה-worker מדפיס אזהרה אחת עם מספר ה-features שדולגו.

### 2.3 כיוונון

| מה רוצים לשנות | איפה |
|---|---|
| מתי shape הופך לגיאומטריה (גודל בפיקסלים) | `REVEAL_SIZE_PX` ב-`src/map-constants.ts` (ברירת מחדל 32) |
| צבעי פוליגונים וקווים | `SHAPE_POLYGON_FILL`, `SHAPE_POLYGON_OUTLINE`, `SHAPE_LINE_COLOR` |
| כמות וגדלים של נתוני הדמו | `src/main.ts` (כמויות), `SHAPE_DIAMETERS_DEG` ו-`SHAPE_WEIGHTS` ב-`src/data.ts` |
| מרווח בין בועות | `CLUSTER_RADIUS_PX` (מחושב מגודל הבועות, ראו מסמך 1, 6.5) |

---

## 3. מושגים

### 3.1 reveal zoom (`R`)

לכל shape מחשבים **פעם אחת**, בזמן בניית ה-index, את רמת הזום שממנה הוא מוצג כגיאומטריה:

```
s = הצלע הגדולה של ה-bbox של ה-shape, ביחידות עולם של web-mercator (0..1, העולם כולו = 1)
R = ceil( log2( REVEAL_SIZE_PX / (s * TILE_SIZE_PX) ) )
```

- ב-zoom `z`, אריח מוצג בגודל 256 עד 512 פיקסלים (`CameraHandler` משתמש ב-`floor`). לכן מ-`R` והלאה ה-shape תופס לפחות `REVEAL_SIZE_PX` פיקסלים על המסך.
- `z < R`: ה-shape הוא **נקודה** ומשתתף ב-clustering.
- `z >= R`: ה-shape מצויר כ**גיאומטריה** ולא מופיע כנקודה.
- `R <= 0` (shape ענק): תמיד גיאומטריה. הוא לא נכנס בכלל ל-cluster index.
- `R` נחתך ל-`maxZoom + 1` (19). shape שה-`R` שלו 19, כולל shape בגודל אפס (`s = 0`), **תמיד נשאר נקודה**.

**דוגמה** (בקו רוחב של ישראל, ~31°, שבו ציר ה-y של mercator "מתוח" פי ~1.17):

| קוטר ה-shape | `R` משוער | הערה |
|---|---|---|
| ~100 מ' | 16 | מופיע רק בזום קרוב מאוד |
| ~1 ק"מ | 12 | |
| ~10 ק"מ | 9 | |
| ~50 ק"מ | 7 | זום הנחיתה של הדמו הוא בערך 8, אז הם כבר מצוירים |

הפוליגונים האקראיים בפועל קטנים מהקוטר המקסימלי של ה-bucket, ולכן ה-`R` שלהם לרוב גבוה יותר.

### 3.2 anchor point

הנקודה שמייצגת shape כל עוד הוא קטן מדי (`src/indexing/reveal.ts`, `anchorPoint`):

- **Polygon:** `pointOnFeature` של turf, נקודה **שמובטח שנמצאת על הפוליגון**. centroid (מרכז מסה) יכול ליפול מחוץ לפוליגון קעור, למשל בצורת U, או בתוך חור.
- **LineString:** הנקודה באמצע אורך הקו (`along(line, length/2)`). לקו באורך אפס, הקודקוד הראשון.

---

## 4. ארכיטקטורה

```
 main thread                                               Web Worker
 ───────────                                               ──────────
 data.ts: points + polygons + lines
 client.build(features, IndexOptions) ── postMessage ──►  FeatureIndex.load(features)
                                                            ├─ toIndexItems: anchor + bbox + R לכל shape
                                                            ├─ RevealSupercluster.load(points + anchors)
                                                            └─ Flatbush על ה-bbox של ה-shapes
                                        ◄── "built" ─────
 CameraHandler → TileRenderer
   client.tile(z,x,y) ───────────────── postMessage ──►  FeatureIndex.getTile(z,x,y)
                                                            ├─ features: clusters + singles (בלי shapes שנחשפו)
                                                            └─ shapes:   shapes שחותכים את האריח ו-R <= z
                                        ◄── "tile" ──────
   TileRenderer:  clusters/singles → Billboard / PointPrimitive (כמו קודם)
                  shapes          → ShapeLayer.addTile(tileKey, shapes)
                                       └─ EntityShapeDrawer (Cesium entities)
```

### 4.1 קבצים חדשים

| קובץ | אחריות |
|---|---|
| `src/indexing/mercator.ts` | פונקציות טהורות: `lngX`, `latY` (זהות לפונקציות הפנימיות של Supercluster), `tileBBox(z,x,y)` |
| `src/indexing/reveal.ts` | `revealZoom(bbox, maxZoom)`, `anchorPoint(geometry)` |
| `src/indexing/reveal-supercluster.ts` | `RevealSupercluster`: subclass של `Supercluster` שמחליף רק את `load()` |
| `src/indexing/feature-index.ts` | `toIndexItems`, `FeatureIndex`: ה-facade שה-worker משתמש בו |
| `src/rendering/shape-layer.ts` | `ShapeDrawer` (interface), `ShapeLayer` (ספירת הפניות לכל אריח) |
| `src/rendering/entity-shape-drawer.ts` | `EntityShapeDrawer`: ציור shapes כ-Cesium entities |
| `src/test-utils/feature-builders.ts` | builders לנתוני בדיקה |
| `src/**/*.test.ts` | בדיקות Vitest |

כל מה שב-`src/indexing/` רץ ב-worker, ולכן **אסור לעשות שם import של Cesium**.

### 4.2 קבצים שהשתנו

- `src/cluster-worker.ts`: עובד עם `FeatureIndex` במקום `Supercluster` ישירות. בקשת `clusters` הוסרה.
- `src/cluster-worker-client.ts`, `src/global.d.ts`: ה-protocol החדש (סעיף 6).
- `src/rendering/tile-renderer.ts`: מחזיק `ShapeLayer` ומעביר אליו את ה-shapes של כל אריח.
- `src/picking.ts`: לחיצה על shape, ותוכן בועה שכולל shapes.
- `src/data.ts`: `buildRandomShapeFeatures` עם buckets של גדלים ומשקלים.
- `index.html`: שורת `Shapes (drawn)` ב-HUD ושינוי שם השורה `Singles`.
- `src/rendering/cluster-renderer.ts`: **נמחק** (לא היה מחובר, ותלוי בבקשה שהוסרה).
- `package.json`: `supercluster` נעול לגרסה **`8.0.1` בדיוק**, ונוספו `flatbush`, חבילות turf ו-`vitest`.

---

## 5. ה-index לעומק

### 5.1 `toIndexItems`: הפיכת features ל-items

לכל feature:
- **Point** → item עם `revealZoom: Infinity` (תמיד משתתף ב-clustering).
- **Polygon / LineString:**
  - מחשבים `bbox` ו-`R`. אם `R` אינו מספר סופי (למשל קואורדינטות `NaN`), ה-feature מדולג.
  - ה-shape נשמר ברשימת ה-shapes (`IndexedShape`: `id`, `kind`, `coordinates`, `bbox`, `revealZoom`).
  - אם `R > 0`, נוסף גם anchor item עם `properties: { kind, featureId, revealZoom: R }`.
- **ריק או לא נתמך** → `skipped++`.
- לכל item יש `id: featureId`, כך ש-Supercluster מעביר את ה-id בתוצאות.

### 5.2 `RevealSupercluster`: הלב של הפתרון

**איך Supercluster בונה את ההיררכיה:** הוא מתחיל ברמה `maxZoom + 1`, שבה כל הנקודות בנפרד, ויורד רמה אחרי רמה עד 0. כל רמה `z` נבנית על ידי clustering של הרמה `z + 1` שמעליה (`_cluster(tree, z)`). כל רמה נשמרת ב-`trees[z]`.

**השינוי היחיד שלנו:** רגע **לפני** שבונים את רמה `R - 1`, מוסיפים לעץ של רמה `R` את ה-anchors שה-`R` שלהם הוא בדיוק `R`. התוצאה:

- ה-anchor קיים ברמות `R - 1` ומטה, ושם הוא נכנס ל-clusters כמו כל נקודה. המספרים והמיקומים של הבועות **מדויקים**.
- ברמות שמעל `R` הוא לא קיים בכלל.
- **פרט עדין:** ה-anchor נשאר גם בעץ של רמה `R` עצמה, כנקודה בודדת. זה הכרחי כדי ש-`getLeaves` של בועה ברמה `R - 1` ימצא אותו. לכן `FeatureIndex.getTile` **מסנן** ב-zoom `R` נקודות בודדות עם `revealZoom <= z`, כי ב-zoom הזה ה-shape מצויר כגיאומטריה.
- ה-anchors החדשים נוספים **לסוף** המערך של העץ, כך שהאינדקסים הקיימים לא זזים וה-cluster ids נשארים תקינים.

הקוד מעתיק את ה-`load()` של הספרייה (`node_modules/supercluster/index.js:39-87`) כמעט שורה בשורה, והשינוי מסומן בהערה `// CHANGE`. כל שאר המתודות (`getTile`, `getLeaves`, `getChildren`, `map/reduce`) הן של הספרייה עצמה.

### 5.3 פירוט סוגים בבועה (`map` / `reduce`)

ל-Supercluster יש תמיכה מובנית ב-`map`/`reduce`. כל item ממופה ל-`{ points, polygons, lines }`, עם 1 בשדה של הסוג שלו, ו-`reduce` סוכם. כך לכל בועה יש בשדות ה-`tags` שלה, למשל, `points: 40, polygons: 7, lines: 3`, ומתקיים `points + polygons + lines === point_count`.

### 5.4 ה-shape index (Flatbush)

- `Flatbush` הוא R-tree סטטי ומהיר מאוד, בנוי על ה-bbox של כל shape שה-`R` שלו `<= maxZoom`. shapes עם `R` גדול יותר לא יצוירו אף פעם.
- בכל בקשת אריח: `search(tileBBox(z,x,y))`, סינון לפי `revealZoom <= z`, והחזרת `{ id, kind, coordinates }`.
- shape שחוצה כמה אריחים יוחזר **בכל אחד מהם**. את הכפילות פותר `ShapeLayer` (סעיף 7.1).

### 5.5 מה `getTile` מחזיר

```ts
{
  features: TileItem[],   // clusters + singles (כולל anchors עם R > z), בקואורדינטות של האריח
  shapes:   TileShape[]   // { id, kind: "polygon" | "line", coordinates } ב-lon/lat
}
```

`TileItem` מוגדר כ-`Supercluster.TileFeature<ClusterBreakdown, ItemProps> & { id?: string }`. סדר ה-generics ב-`@types/supercluster` הוא `<ClusterProps, PointProps>`, וה-`id` נוסף כי ה-typings של הספרייה משמיטים אותו.

---

## 6. ה-protocol בין ה-main thread ל-worker

| הודעה | לפני ה-branch | אחרי ה-branch |
|---|---|---|
| `build` | `{ points: Feature<Point>[], options: { minPoints, radius (px), maxZoom } }` | `{ features: Feature<Geometry>[], options: IndexOptions }`, כאשר `IndexOptions = { minPoints, radiusPx, maxZoom }`. ההמרה ל-extent נעשית בתוך `FeatureIndex` |
| `tile` → `tile` | `{ z, x, y, extent, features }` | `{ z, x, y, extent, features: TileItem[], shapes: TileShape[] }` |
| `leaves` → `leaves` | leaves של נקודות | leaves עם `properties: { kind, featureId, revealZoom }`, וה-feature המקורי נמצא ב-`byId` |
| `clusters` | קיים (שימש את `ClusterRenderer`) | **הוסר** |
| `buildVectorTiles` / `getVectorTile` | ללא שינוי | ללא שינוי (הניסוי המכובה) |

---

## 7. צד ה-main thread

### 7.1 `ShapeLayer`: ספירת הפניות

לכל shape סופרים כמה אריחים "מחזיקים" אותו:

- `addTile(tileKey, shapes)`: לכל shape באריח, `refCount++`. ב-0 → 1 ה-shape **מצויר**.
- `removeTile(tileKey)`: לכל shape של האריח, `refCount--`. ב-1 → 0 ה-shape **נמחק**.

**דוגמה:** פוליגון P חוצה את האריחים A ו-B.
1. A מוכן → `refCount(P) = 1` → P מצויר.
2. B מוכן → `refCount(P) = 2` → לא קורה כלום.
3. A יוצא מה-view → `refCount(P) = 1` → P נשאר.
4. B יוצא → `refCount(P) = 0` → P נמחק.

**הגנות נוספות:**
- `addTile` על אריח שכבר קיים לא עושה כלום.
- כפילויות של אותו id בתוך אותו אריח נספרות פעם אחת.
- `removeTile` על אריח לא מוכר לא עושה כלום.

**בזמן zoom:** אריחי הזום החדש נוספים **לפני** שאריחי הזום הישן (stale) נמחקים. shape משותף לשניהם לא נמחק ולא מצויר מחדש, ולכן אין הבהוב.

**Batching:** `ShapeLayer` קורא ל-`beginBatch()` / `endBatch()` האופציונליים של ה-drawer סביב כל אריח. `EntityShapeDrawer` משתמש בהם כדי לעשות `suspendEvents()` / `resumeEvents()`, וקורא ל-`requestRender()` פעם אחת לכל אריח במקום פעם לכל shape.

**למה דרך interface:** `ShapeLayer` לא מכיר את Cesium. זה מאפשר לבדוק את לוגיקת הספירה ב-unit tests עם fake drawer.

### 7.2 `EntityShapeDrawer`

- `CustomDataSource("shapes")` ייעודי.
- id של entity: `shape:<featureId>`. ב-`properties.featureId` נשמר ה-id לצורך picking.
- **Polygon:**
  - `PolygonHierarchy` עם הטבעת החיצונית והחורים.
  - `height: 0`. הפוליגון **לא** מוצמד לקרקע, כי אין terrain. בזכות זה ה-outline עובד.
  - fill: `SHAPE_POLYGON_FILL`; outline: `SHAPE_POLYGON_OUTLINE`.
- **LineString:** `polyline` ברוחב 2px בצבע `SHAPE_LINE_COLOR`.
- כל הערכים קבועים (בלי `CallbackProperty`), ולכן Cesium מאחד entities עם אותו מראה ל-primitives משותפים.

### 7.3 שילוב ב-`TileRenderer`

- כשאריח מוכן (`processTileFeatures`), ה-shapes שלו עוברים ל-`shapeLayer.addTile`.
- `removeTile` קורא ל-`shapeLayer.removeTile`. זו **הנקודה היחידה** שכל סוגי ההסרה עוברים בה: אריח pending שבוטל, אריח stale שהוחלף, ניקוי.
- תשובה לאריח שכבר לא `pending` נדחית לפני שמגיעים ל-`ShapeLayer`.

### 7.4 Picking

- **shape:** `drillPick` מחזיר `Entity`, וה-feature נמצא לפי `properties.featureId`. ה-ids נאספים ב-`Set`, כי fill ו-outline של אותו פוליגון יכולים לחזור פעמיים.
- **בועה:** `leaves(cluster_id)`, וכל leaf מתורגם ל-feature המקורי לפי `featureId`.

---

## 8. החלטות טכניות והסבר

### 8.1 למה גודל על המסך ולא זום אחד לכולם
עם זום אחד לכולם, פוליגון ענק הוא נקודה קטנה כשמסתכלים מרחוק, ופוליגונים זעירים מצוירים כ"פירורים" חסרי משמעות. עם גודל על המסך, כל shape מופיע בדיוק כשיש טעם לראות אותו.

### 8.2 למה subclass של Supercluster
נשקלו שלוש חלופות:

| חלופה | יתרון | חיסרון |
|---|---|---|
| **A: subclass שמחליף רק את `load()`** (נבחרה) | מדויק, הבנייה מהירה כמו היום, ורוב הלוגיקה נשארת של הספרייה | תלוי בפרטים פנימיים של Supercluster |
| B: Supercluster נפרד לכל רמת זום | אין קוד פנימי | זמן בנייה וזיכרון פי ~19 |
| C: index אחד עם כל ה-shapes כנקודות, וחיסור בזמן שאילתה | הכי זול | מיקומי הבועות שגויים בדיוק בזומים שבהם shapes נחשפים |

בהתחלה נשקל גם מימוש מחדש של כל האלגוריתם. הוא נדחה כדי לא לתחזק עותק של ספרייה.

### 8.3 הסיכון בחלופה A ואיך מתמודדים איתו
ה-subclass משתמש ב-`_createTree`, ב-`_cluster`, במבנה המערך הפנימי (stride ו-offsets) וב-`trees`. אלה פרטים פנימיים, וגרסה עתידית יכולה לשנות אותם.

- **הגרסה נעולה** ל-`"supercluster": "8.0.1"` (בלי `^`), כך ששדרוג קורה רק בכוונה.
- **בדיקת שקילות (equivalence):** על נקודות בלבד, `RevealSupercluster` חייב להחזיר **בדיוק** את אותם אריחים כמו `Supercluster` רגיל, גם בלי `map/reduce` וגם איתם. אם שדרוג שובר משהו, הבדיקה נכשלת מיד.
- **נוהל שדרוג:** מעלים גרסה, מריצים `npm test`, ואם נכשל משווים את `load()` של הגרסה החדשה לקוד שלנו.
- **מעקב אחרי גרסאות:** `npm outdated`, או ב-GitHub "Watch → Custom → Releases" על `mapbox/supercluster`, או Dependabot/Renovate. הספרייה בוגרת ומשתנה לעיתים רחוקות.

### 8.4 למה Flatbush
R-tree סטטי (הנתונים לא משתנים אחרי הבנייה), קטן ומהיר מאוד לשאילתות bbox. אין צורך בעץ דינמי כמו `rbush`.

### 8.5 למה Entities ולא Primitives
ה-reveal rule מבטיח שכל shape מצויר גדול לפחות `REVEAL_SIZE_PX`, אבל **לא** מגביל את **מספר** ה-shapes. המספר תלוי בצפיפות הנתונים. לכן נתוני הדמו משוקללים לכיוון shapes קטנים. Entities הם הפתרון הפשוט ל-POC. אם מדידה תראה בעיה, המעבר ל-`Primitive` עם הרבה `GeometryInstance`s הוא שינוי **בתוך `EntityShapeDrawer` בלבד** (בזכות ה-interface `ShapeDrawer`).

### 8.6 למה הגיאומטריה המלאה נשלחת בכל אריח
פשטות: ה-main thread לא צריך להחזיק עותק של הנתונים. המחיר הוא ש-shape שחוצה כמה אריחים נשלח כמה פעמים. ל-shapes קטנים, עם עשרות קודקודים, זה זניח. לנתונים כבדים, אפשר לשלוח רק ids של shapes שכבר מצוירים.

### 8.7 נתוני הדמו
- `SHAPE_DIAMETERS_DEG = [0.001, 0.01, 0.1, 0.5]` (בערך 100 מ', 1 ק"מ, 10 ק"מ, 50 ק"מ).
- `SHAPE_WEIGHTS = [0.6, 0.3, 0.09, 0.01]`: רוב ה-shapes קטנים. בחלוקה שווה, אלפי פוליגונים גדולים כיסו את כל המסך כבר בזום הנחיתה והסתירו את הבועות.
- שימו לב: ב-turf, `max_radial_length` הוא **רדיוס**, ולכן מעבירים `diameter / 2`.

---

## 9. דברים חשובים שצריך לדעת (מגבלות וסיכונים)

1. **`MultiPolygon` / `MultiLineString` לא נתמכים** ומדולגים. אם בנתונים האמיתיים יש כאלה, צריך לפרק אותם או להוסיף תמיכה.
2. **shapes שחוצים את ה-antimeridian (180°)** לא נתמכים, כי ה-bbox הנאיבי שלהם מכסה את כל העולם.
3. **ייצוג כפול לרגע בזמן zoom:** כל עוד אריחי הזום הקודם stale, shape שזה עתה נחשף יכול להופיע כגיאומטריה בזמן שהבועה הישנה שהכילה אותו עדיין על המסך. זה נמשך עד שכל האריחים החדשים מוכנים (בדרך כלל מילישניות).
4. **ייחודיות ids:** אם יש features בלי `id`, ה-id שלהם הוא האינדקס במערך. זה יכול להתנגש עם `id` מפורש של feature אחר (למשל `id: 3` מול הפריט הרביעי בלי id), וההתנגשות תגרום לשגיאה ב-`entities.add`. **ב-production, ודאו ids ייחודיים.**
5. **קואורדינטות `NaN` חלקיות:** פוליגון שכל הקואורדינטות שלו `NaN` מדולג. פוליגון עם `NaN` חלקי יכול לקבל bbox בגודל אפס, ולכן להישאר נקודה במקום לדלג עליו.
6. **קואורדינטות דו-ממדיות בלבד:** `EntityShapeDrawer` משתמש ב-`ring.flat()`. קואורדינטה עם גובה (`[lon, lat, alt]`) תתפרש לא נכון.
7. **ביצועים עם הרבה shapes גדולים:** כל הוספה או הסרה של entity גורמת ל-Cesium לבנות מחדש את ה-batch המשותף. עם אלפי shapes גלויים זה יורגש. ראו 8.5.
8. **`ShapeLayer` בלי `try/finally`:** אם `drawer.add` זורק שגיאה, `endBatch` לא ייקרא וה-entity collection יישאר במצב suspended.
9. **הניקוי ב-`destroy`:** `TileRenderer.destroy` לא מוחק את ה-data source של ה-shapes. כרגע `destroy` לא נקרא אף פעם.
10. **כל הבעיות הידועות ממסמך 1 עדיין קיימות:** cache, tilt, לוגים, OSM ועוד.

---

## 10. בדיקות

### 10.1 הרצה

```bash
npm test            # vitest run (כל הבדיקות)
npx vitest run src/indexing/feature-index.test.ts   # קובץ אחד
npx tsc --noEmit -p .                                # בדיקת טיפוסים
```

בזמן הכתיבה: 22 בדיקות, כולן עוברות. בבדיקת הדילוג אמורה להופיע אזהרה אחת (`FeatureIndex: skipped ...`), וזה צפוי.

### 10.2 מה נבדק

| קובץ | מה בודק |
|---|---|
| `reveal.test.ts` | נוסחת `R` (ערך ידוע, גודל אפס, חיתוך ל-`maxZoom + 1`, shape בגודל עולם); anchor בתוך פוליגון בצורת U ומחוץ לחור; אמצע קו; קו באורך אפס |
| `reveal-supercluster.test.ts` | **equivalence** מול Supercluster רגיל, בלי ועם `map/reduce`; anchor נמצא בבועה ב-`R - 1` בלבד |
| `feature-index.test.ts` | shape הוא נקודה מתחת ל-`R` וגיאומטריה מ-`R`; שימור ספירות וה-breakdown בכל זום; דילוג על גיאומטריות ריקות, Multi ו-`NaN`; ids לfeatures בלי id; index בלי נקודות בכלל; אריח ריק; shape בגודל אפס מעל `maxZoom` |
| `shape-layer.test.ts` | ציור אחד ל-shape בשני אריחים; מחיקה רק אחרי האריח האחרון; zoom swap בלי ציור מחדש; הסרת אריח לא מוכר |

### 10.3 מוסכמות כתיבת בדיקות

- שם הבדיקה: `<method> given <use case>`, למשל `"revealZoom given a zero-size bbox returns maxZoom + 1"`.
- בכל בדיקה יש הערות `// given`, `// when`, `// then` נפרדות, ו-assertions רק תחת `// then`.
- נתונים נוצרים ב-builders (`src/test-utils/feature-builders.ts`) עם ערכים אקראיים כשהערך המדויק לא חשוב.
- Vitest רץ **בלי globals**: מייבאים `describe`, `it` ו-`expect` מ-`"vitest"`.
- הבדיקות רצות על Supercluster האמיתי, בלי mocks.

**מה לא נבדק אוטומטית:** הציור ב-Cesium והתנהגות בדפדפן. יש לבצע בדיקה ידנית:
1. בזום רחוק, פוליגונים גדולים נראים ליד הבועות.
2. בזמן התקרבות, shapes קטנים "יוצאים" מהבועות ומצוירים.
3. אחרי שהאריחים מתייצבים, אף shape לא מוצג גם כגיאומטריה וגם בתוך בועה.
4. ה-HUD מתעדכן.
5. לחיצות מדפיסות את ה-features הנכונים.

---

## 11. לפני production: רשימת משימות מומלצת

1. **טעינת נתונים אמיתיים בתוך ה-worker** (fetch או parse שם), במקום ליצור אותם ב-main thread ולהעתיק.
2. **ids ייחודיים ויציבים** לכל feature.
3. **שרת אריחים משלכם** במקום OSM.
4. **מדידת ביצועים בדפדפן** עם הנתונים האמיתיים. אם יש הרבה shapes גלויים, לעבור ל-`Primitive`s (8.5).
5. **cache לאריחים** ו-**בחירת אריחים לפי גודל על המסך**, לפי `docs/cluster-flow.md`.
6. **הסרת לוגי הדיבוג** מ-`TileRenderer`.
7. **החלטה על Multi\*:** לפרק ל-features נפרדים, או להוסיף תמיכה.
8. **טיפול בשגיאות ב-worker:** כרגע אין הודעת `error`. שגיאה בבנייה תשאיר את המפה ריקה בלי הסבר.
9. **שדרוג Supercluster** רק לפי הנוהל שבסעיף 8.3.
