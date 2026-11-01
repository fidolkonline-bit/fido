import { db } from "@/lib/db";

export async function catalogOptions() {
  const [categories, brands, units, warranties] = await Promise.all([
    db.category.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { parent: true } }),
    db.brand.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.warranty.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.parent ? `${c.parent.name} › ${c.name}` : c.name })),
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    units: units.map((u) => ({ id: u.id, name: `${u.name} (${u.shortName})` })),
    warranties: warranties.map((w) => ({ id: w.id, name: w.name })),
  };
}
