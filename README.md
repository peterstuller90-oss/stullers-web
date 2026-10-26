# Štullers – web s administráciou

Web street art dua Štullers (stullerscreative.com) s hrou na úvodnej stránke, galériami Steny,
Workshopy, Ilustrácie a Grafický dizajn, obchodom, formulárom na objednanie workshopu
a vlastnou administráciou na adrese `/admin`.

Beží na bežnom PHP hostingu (Websupport), bez databázy – obsah je v JSON súboroch v priečinku `data/`.

## Štruktúra

| Priečinok / súbor | Čo obsahuje |
| --- | --- |
| `index.php` | verejný web – vloží zverejnený obsah do šablóny |
| `web.html` | šablóna webu: dizajn, hra, animácie (prehliadač ju priamo neotvára) |
| `admin/` | administrácia (texty, projekty, obchod a mockupy, médiá, SEO, rebríček, zadania, história) |
| `api/` | serverová časť v PHP (`admin.php`, `stullers-hra.php`, `lib.php`) |
| `media/` | fotky a video webu, `media/uploads/` = súbory nahraté v administrácii |
| `defaults/` | pôvodný obsah webu pre prvé spustenie |
| `data/` | koncept, zverejnený obsah, história, heslo, rebríček, zadania – **nie je v gite** |

## Požiadavky

PHP 7.4 alebo novšie (odporúčané 8.x), rozšírenie `fileinfo`, Apache s `.htaccess`, HTTPS.

## Nasadenie

1. Nahraj obsah repozitára na hosting (aj súbory začínajúce bodkou – `.htaccess`).
2. Priečinky `data/` a `media/uploads/` musia byť zapisovateľné.
3. Otvor `https://(adresa)/admin/`, inštalačný kód nájdeš na hostingu v `data/INSTALACNY-KOD.txt`, nastav heslo.

Podrobný návod je v [NAVOD.txt](NAVOD.txt).

## Bezpečnosť

- V repozitári nie sú žiadne heslá ani kľúče. Heslo sa nastavuje až na hostingu a ukladá sa len ako odtlačok v `data/`.
- Priečinok `data/` a nahraté súbory sú v `.gitignore` – nikdy ich necommituj.
- Záloha obsahu webu = stiahnuť z hostingu priečinky `data/` a `media/`.
