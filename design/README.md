# Fido Shop — IDE design starter

Editable source for the whole-system design preview discussed in the conversation.
The original navigation, styling, screen definitions, and demo interactions are
preserved. This is a design prototype with fictional sample records, not a working
shop system. The new design has no WordPress or WooCommerce dependency.

## Open it

1. Extract the ZIP.
2. Open the `fido-design-ide` folder in VS Code, Cursor, WebStorm, or another IDE.
3. Open `index.html` in a current browser. No installation or build step is required.

For live editing, use your IDE's local preview extension. Alternatively, run this
command from the project folder and open http://localhost:8000:

```sh
python3 -m http.server 8000
```

`standalone.html` is the single-file export of the original conversation preview.
Double-click it to open the self-contained version. The split source files are
easier to maintain in an IDE. Both support light and dark system appearance;
change `color-scheme: light dark` to `color-scheme: light` in `styles.css` to keep
the split source on the warm-paper light appearance.

## Files

| File | Edit here for |
| --- | --- |
| `index.html` | Application shell and main markup |
| `styles.css` | Colors, typography, spacing, tables, forms, responsive layouts |
| `app.js` | Modules, screen definitions, fictional records, renderers, interactions |
| `standalone.html` | Self-contained export of the original preview |
| `SPECIFICATION.md` | Complete development baseline and acceptance criteria |

## What the prototype includes

- 18 navigation groups, 64 navigable demo views, and a 36-report index.
- User management, contacts, products, repairs, purchases, sales, stock transfers,
  stock adjustments, expenses, payment accounts, reports, notifications, settings,
  HRM, Essentials, reloads, and staff tasks.
- Table search, sample record details, draft forms, sample POS cart interactions,
  report filter previews, and invoice layout controls.
- Graphite navigation, warm-paper surfaces, a restrained brick-red accent, and
  responsive layouts. Most screens share table and form templates; dedicated
  production workflows still need implementation.

## Where to change things

In `app.js`, `groups` defines the navigation. Calls to `page(...)` register screen
titles, columns, sample rows, and draft form fields. `reports` holds the report
index. The `renderHome`, `renderPos`, `renderReports`, and `renderPrinting`
functions provide specialized views. `openPage` renders the selected screen.

In `styles.css`, the root `--fs-*` tokens define the palette. All product styles
are scoped beneath `#fido-system-design`. Keep those identifiers consistent with
the shell and JavaScript when refactoring.

The split files are the editable working copy; they do not automatically rebuild
`standalone.html`. Re-export or update that snapshot if you choose to distribute
a later single-file version.

## Production work still required

The preview has no database, authentication, permissions enforcement, server,
stock ledger, financial posting engine, payment handling, real SMS delivery,
background alarms, actual invoice/label printing, or data migration. Sample forms
do not persist records, and page reloads reset the demo. Do not enter real shop
records, passwords, customer phone numbers, or device unlock credentials here.

Use `SPECIFICATION.md` as the development baseline. It distinguishes observed
legacy behavior, owner requests, proposed rules, and unresolved verification
gates. Confirm provider commission rules, payroll requirements, printer hardware,
and gated legacy workflows before implementing those business rules. The shop's
current production system remains separate from this prototype.

## Suggested first development step

Keep this folder as the visual reference. Implement the backend domain model and
stock/payment ledgers from the specification, then connect one complete workflow
at a time. If you move the UI into React, Vue, or another framework, preserve the
navigation labels, colors, spacing, and familiar workflow order from these files.

## Verification of this export

The exported JavaScript passes Node syntax checking. Registry checks confirm
unique screen IDs, valid navigation groups, and matching table column/row widths.
The product CSS and JavaScript are copied from the original preview, with only
standalone document setup and source comments added. Browser rendering and
production workflows have not been validated by this export.
