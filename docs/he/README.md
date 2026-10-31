# תיעוד הפרויקט (עברית)

התיעוד מיועד למפתחים שמקבלים את ה-POC הזה ומעבירים אותו לאפליקציית production.
הטקסט בעברית. שמות של קבצים, מחלקות, פונקציות ומונחים טכניים נשארים באנגלית, כמו שהם מופיעים בקוד.

## סדר קריאה מומלץ

| # | מסמך | מה יש בו |
|---|---|---|
| 1 | [01-poc-baseline.md](01-poc-baseline.md) | מצב ה-POC **לפני** ה-branch `feature/shape-clustering`: איך מריצים, איך ה-clustering של נקודות עובד, ההחלטות הטכניות והבעיות הידועות |
| 2 | [02-shape-clustering.md](02-shape-clustering.md) | מה ה-branch `feature/shape-clustering` הוסיף: polygons ו-polylines שמשתתפים ב-clustering, ה-index החדש, הבדיקות ומה צריך לדעת לפני production |
| 3 | [03-performance-and-native-clustering.md](03-performance-and-native-clustering.md) | גבולות הביצועים (עם מדידות), והשוואה ל-`EntityCluster` המובנה של Cesium: למה בחרנו ב-index מראש, ומתי הפתרון המובנה מספיק |
| 4 | [04-uncluster-feature-plan.md](04-uncluster-feature-plan.md) | תוכנית high level לפיצ'ר Uncluster / Cluster back מ-context menu, כולל הפערים הפתוחים ב-design |

כדאי לקרוא לפי הסדר: כל מסמך מניח שאתם מכירים את ה-flow שמתואר במסמכים שלפניו.

## מסמכים נוספים (באנגלית)

- `docs/cluster-flow.md`: תיאור קצר של ה-cluster flow, בעיות ידועות ועצות ביצועים.
- `docs/vector-tiles-flow.md`: ה-flow של vector tiles (`geojson-vt`), שכרגע מכובה.
- `docs/superpowers/specs/2026-10-29-shape-clustering-design.md`: מסמך ה-design של ה-shape clustering.
- `docs/superpowers/plans/2026-10-29-shape-clustering.md`: תוכנית המימוש, task אחרי task.

## מילון מונחים קצר

| מונח | הסבר |
|---|---|
| `feature` | אובייקט GeoJSON אחד: נקודה (`Point`), קו (`LineString`) או פוליגון (`Polygon`), עם `id` ו-`properties` |
| cluster / בועה | קבוצה של features קרובים שמוצגת כעיגול אחד עם מספר |
| single | feature שלא נכנס לאף cluster ומוצג לבד (נקודה קטנה) |
| zoom level (`z`) | רמת הזום בשיטת web-mercator: ב-`z` העולם מחולק ל-`2^z × 2^z` אריחים |
| tile / אריח | ריבוע במפה, מזוהה לפי `z/x/y` (בקוד: `tileKey = "z/x/y"`) |
| `extent` | הרזולוציה של הקואורדינטות בתוך אריח (כאן 4096) |
| Web Worker | thread נפרד בדפדפן שמריץ JavaScript בלי לחסום את ה-UI |
| main thread | ה-thread הראשי של הדף, שבו רצים ה-UI ו-Cesium |
| Cesium `Viewer` | הרכיב הראשי של CesiumJS שמציג את הגלובוס |
| billboard | תמונה (sprite) שמוצגת במיקום תלת-ממדי ותמיד פונה למצלמה; כך מוצגות הבועות |
| reveal zoom (`R`) | (ב-branch) רמת הזום שממנה shape מוצג כגיאומטריה אמיתית ולא כנקודה |
| anchor point | (ב-branch) הנקודה שמייצגת shape כל עוד הוא קטן מדי על המסך |
