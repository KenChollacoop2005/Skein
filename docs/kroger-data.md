# Kroger data notes

All examples below are real responses from the Kroger Public API, fetched on 2026-10-29.

## Target store

There is no Kroger with a Prices Fork Road street address. The Locations API search for ZIP 24060 returns:

| locationId | Name | Address |
|---|---|---|
| 02900210 | Kroger - University City | 903 University City Blvd, Blacksburg |
| 02900402 | Kroger - Gables | 1322 S Main St, Blacksburg |
| 02900345 | Kroger - Christiansburg | 555 N Franklin St, Christiansburg |

The University City store sits at the corner of University City Blvd and Prices Fork Road, so it is the target: **locationId 02900210**.

Departments listed for it include: Bakery, Deli, Meat Department, Seafood Department, Floral, Pharmacy, Walk-up Pharmacy, Natural And Organics, Sushi, Olive Bar, Salad Bar, Cheese Counter, Murray's Cheese, Boar's Head, Bistro, Chef, Kosher Food, Wine, Beer, Drug & General Merchandise, Perishables, Self Checkout, Pickup, plus services (Bank, ATM, Coinstar, Gas Station, and so on).

## Calls used

- Token: `POST https://api.kroger.com/v1/connect/oauth2/token`, Basic auth, `grant_type=client_credentials&scope=product.compact`. Cached until a minute before `expires_in`.
- Locations: `GET /v1/locations?filter.zipCode.near=24060&filter.chain=Kroger&filter.limit=10`.
- Products: `GET /v1/products?filter.term=<term>&filter.locationId=02900210&filter.limit=10`. Calls are paced 350 ms apart. Building the catalog took 322 calls (1 location, 321 products).

## What aisleLocations looks like

Normal aisle item (peanut butter):

```json
{"bayNumber":"14","description":"AISLE 14","number":"14","numberOfFacings":"2","side":"L","shelfNumber":"2","shelfPositionInBay":"1"}
```

Center aisles come back as `AISLE N` with `number` equal to N. The starter list hit aisles 2, 3 and 6 to 25. Frozen food is in numbered aisles, not a perimeter department: frozen pizza is in AISLE 18 and ice cream in AISLES 20 and 21.

Perimeter departments use numbers of 100 and up, a department name, and bays along the wall:

| number | description | bays seen | example |
|---|---|---|---|
| 100 | DAIRY | 2 to 40 | milk, bay 25, side L |
| 101 | MEAT | 1 to 39 | ground beef, bay 20, side L |
| 102 | SEAFOOD | 2 to 9 | salmon fillet, bay 9 |
| 103 | DELI | 2 to 11 | deli turkey, bay 11 |
| 105 | PRODUCE | 1 to 25 | refrigerated produce items |
| 108 | PHARMACY | 3 | one item |
| 300 | CHECKLANE 2, CHECKLANE 12 | 1 | candy and gum at the registers |
| 351 to 355 | PRODUCE TABLE 2 to 6 | 1 to 4 | produce floor tables |
| 441, 444 | DELI 2, DELI 5 | 1 | deli cases |
| 456 to 458 | BAKERY 2 to 4 | 1 to 4 | croissants, bay 3 |

Department only entries have `number` "0" and no bay: `FRUIT` (bananas, oranges), `VEGETABLES` (onions, tomatoes), `PRODUCE` (apples, grapes), `DELI/BAKE` (rotisserie chicken, sushi), `MEAT`, `GROCERY` (crackers, soda, English muffins) and `DRUG/GM` (propane, magazines). `GROCERY` and `DRUG/GM` don't say where in the store the item is.

Entries that are not a real shelf spot:

- `VIRTUAL PLANOGRAM`, number 998, bay 999: gift cards.
- `FRONT-OTHER`, number 150, bay 999: a second spot for some items, likely an endcap or front display.

Items with no location at all: an empty `aisleLocations` list. In the starter list only 2 of 321 picks ended up without a usable spot (gift card and firewood). Some products in search results had an empty list (for example one bagel product and one salmon product), so the build tool skips to the next result.

Products can list several locations. The tools keep the first one that is not virtual and not bay 999.

## Bay direction and side

The data alone can't tell whether bay 1 is at the front or the back of an aisle, and it doesn't define `side`. `side` is L or R, and aisle items use both. Wall departments (Dairy, Meat, Seafood, Deli) are almost all L, which fits L meaning the shelf on your left as you walk the wall in increasing bay order, but that is a guess. The editor has a "bay 1 end" setting and an "L side" toggle per aisle so Ken can set both after checking two items in the store.

## How descriptions map to layout zones

Zones in `data/store.json` carry match strings. An item goes to the first zone whose match string appears in its description. Otherwise it goes to the aisle with the same number.

| Zone | Match strings |
|---|---|
| Produce | PRODUCE, FRUIT, VEGETABLES |
| Dairy | DAIRY |
| Meat | MEAT |
| Seafood | SEAFOOD |
| Deli | DELI |
| Bakery | BAKERY |
| Pharmacy | PHARMACY |
| Checklanes | CHECKLANE |

Items that only say `GROCERY` or `DRUG/GM` are treated as unplaced. The app then guesses from keywords or similar catalog items and marks the guess "approximate".

## Temperature

Products include `temperature.indicator` (Ambient, Refrigerated or Frozen). The catalog keeps it as `cold: true` for Refrigerated and Frozen. 97 of 321 items are cold. "Cold items last" uses this flag.

## Rebuilding

```
node tools/kroger.mjs locations 24060
node tools/kroger.mjs probe 02900210 milk "peanut butter" bananas
KROGER_LOCATION_ID=02900210 node tools/build-catalog.mjs
```

All three need `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` set in the shell.
