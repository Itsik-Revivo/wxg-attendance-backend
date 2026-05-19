# WXG Attendance System — Backend

## מבנה הפרויקט

```
attendance/
├── prisma/
│   └── schema.prisma          # הגדרות DB מלאות
├── src/
│   ├── index.ts               # נקודת כניסה, cron jobs
│   ├── middleware/
│   │   ├── auth.ts            # Azure AD JWT + employee lookup
│   │   └── errorHandler.ts
│   ├── routes/
│   │   ├── attendance.routes.ts   # clock-in/out, היסטוריה
│   │   ├── employee.routes.ts     # פרופיל עובד
│   │   ├── project.routes.ts      # פרויקטים + פוליגונים
│   │   ├── report.routes.ts       # דוחות חודשיים + יצוא חילן
│   │   └── admin.routes.ts        # ניהול + סנכרון CRM
│   ├── services/
│   │   ├── attendance.service.ts  # לוגיקת כניסה/יציאה
│   │   ├── crmSync.service.ts     # סנכרון Dynamics GraphQL
│   │   ├── geo.service.ts         # בדיקת פוליגונים GPS
│   │   └── monthlyReport.service.ts # סגירת חודש + יצוא
│   └── utils/
│       └── logger.ts
├── .env.example
├── package.json
└── tsconfig.json
```

## הקמה ראשונית

### 1. Prerequisites
- Node.js 20+
- PostgreSQL (Azure Database for PostgreSQL)
- Azure AD App Registration

### 2. התקנה
```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
```

### 3. Azure AD App Registration
1. צור App Registration ב-Azure Portal
2. הוסף Redirect URI לאפליקציה ולווב
3. הפעל "Access tokens" ו-"ID tokens"
4. הוסף API permission: `User.Read`
5. העתק `tenant-id` ו-`client-id` ל-.env

### 4. הרצה
```bash
npm run dev     # פיתוח
npm run build   # build
npm start       # production
```

## API Endpoints

### Authentication
כל ה-routes דורשים Bearer token מ-Azure AD.

### Attendance
| Method | Path | תיאור |
|--------|------|-------|
| POST | /api/attendance/clock-in | כניסה לעבודה |
| POST | /api/attendance/clock-out | יציאה מעבודה |
| GET | /api/attendance/today | נוכחות היום |
| GET | /api/attendance/month | נוכחות חודשית |

### Projects
| Method | Path | תיאור |
|--------|------|-------|
| GET | /api/projects | פרויקטים מורשים לעובד |
| POST | /api/projects/:id/polygon | הגדרת פוליגון (admin) |
| POST | /api/projects/offices | הגדרת משרד (admin) |

### Reports
| Method | Path | תיאור |
|--------|------|-------|
| GET | /api/reports | רשימת דוחות |
| GET | /api/reports/:id | דוח בודד |
| POST | /api/reports/:id/approve | אישור חשבת שכר |
| GET | /api/reports/export | יצוא Excel לחילן |

### Admin
| Method | Path | תיאור |
|--------|------|-------|
| POST | /api/admin/sync | הפעלת סנכרון CRM |
| POST | /api/admin/work-agreements | הסכם עבודה לעובד |
| GET | /api/admin/sync-log | לוג סנכרון |

## צעדים הבאים

### שלב 4 — React Native App
- מסך כניסה/יציאה עם GPS
- בחירת פרויקט
- היסטוריית נוכחות חודשית
- בקשת תיקון / היעדרות

### שלב 5 — Web Portal
- Dashboard: מי נמצא / מי חסר
- ניהול הסכמי עבודה
- אישור דוחות חודשיים
- ניהול פוליגונים (מפה אינטראקטיבית)
- יצוא לחילן

### שלב 6 — יצוא חילן
- העברת פורמט ← נמתין לקובץ שתשלח
