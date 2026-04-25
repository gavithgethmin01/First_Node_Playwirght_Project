# aPlus Academy lesson scraper

This script signs into your aPlus Academy account, collects lesson titles, sorts them nicely, and saves the result in:

- `lesson-output/lessons.json`
- `lesson-output/lessons.md`

## Setup

1. Install dependencies:

```powershell
cmd /c npm install
```

2. Set your credentials for the current shell:

```powershell
$env:APLUS_USERNAME="0775745457"
$env:APLUS_PASSWORD="your-password"
```

3. Run the scraper:

```powershell
cmd /c npm run scrape
```

## Notes

- The script is built for the JavaScript app at `https://apluseducation.lk`.
- If the site layout changes, the lesson selectors in `scrape-lessons.mjs` may need a quick update.
