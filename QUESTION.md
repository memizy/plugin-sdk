#### `SESSION_ABORTED`

Sent when the Host terminates the session externally (user pressed "Abort", browser tab change, etc.). Plugin MUST stop all timers and MUST NOT send further messages after receiving this.

```typescript
{
  type: 'SESSION_ABORTED',
  payload: {
    reason: 'user_exit' | 'timeout' | 'host_error'
  }
}
```
Potřebujem to?

Odkazuje se že session je v OPFS to ale není pravda, je to jak v api tak i v README
Vylepšit ten playground, nefunguje tam to opakování otázek, projde se to jen jednou nějak, pak je potřeba to nahrát znovu

Doplnit tam jména aplikace a některý ty odkazy

Sourci maj zas dvojižě uveděný odkaz ale možná je to správně aby to bylo proklikatelný
Bylo by hezký aby plugin mohl si vybrat pro gear ikonku kde má být v jakém rohu
Budou pluginy moci přistupovat k dalším url parametrům? jako edit parametr

Tady si něco vymyslel
### Scaffolding a new plugin

A Memizy plugin is a self-contained static web application. The minimal project structure is:

```
my-plugin/
 index.html          # Plugin entry point (MUST contain the OQSE manifest script tag)
 package.json
 vite.config.ts
 tsconfig.json
 src/
    main.ts
 public/
    preview.png     # 512×512 px preview image for the plugin catalog
 README.md
 LICENSE
```

Vyzkoušet jak to umí načítat i .oqse soubory a jak to umí dělat export a import atd.

POTOM
Uzpůsobit tomu i memizy samotné
Udělat proklikatelný i ty další readme tam u nich věci
Později až budu dělat i multiplayer přes pluginy tak můžu okopírovat hry z blooketu a to ve velkým a všechno to navibecodit, když to zvládlo let me in, zvládne to i tohle