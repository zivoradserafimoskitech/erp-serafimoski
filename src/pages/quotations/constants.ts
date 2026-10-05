// Извлечено од Quotations.tsx — само константи (без промена на однесување).
export const qStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  sent: { label: "Испратена", cls: "bg-blue-100 text-blue-700" },
  accepted: { label: "Прифатена", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Одбиена", cls: "bg-red-100 text-red-700" },
  expired: { label: "Истечена", cls: "bg-amber-100 text-amber-700" },
  converted: { label: "Конвертирана", cls: "bg-purple-100 text-purple-700" },
};

export const svcCodes: Record<string, string> = {
  laser_cutting: "ЛС", plasma_cutting: "ПС", bending: "ВТ", mig_welding: "МИГ",
  tig_welding: "ТИГ", grinding: "БР", drilling: "ДП", electrostatic_paint: "ЕФ",
  wet_paint: "МФ", galvanizing: "ПЦ", cnc_machining: "ЦНЦ", labor: "ТР",
  design: "ДЗ", transport: "ТП", installation: "МН", other: "ДР",
};
export const svcTypes: Record<string, string> = {
  laser_cutting: "Ласерско сечење", plasma_cutting: "Плазма сечење", bending: "Виткање",
  mig_welding: "MIG заварување", tig_welding: "TIG заварување", grinding: "Брусење",
  drilling: "Дупчење", electrostatic_paint: "Електростатско фарбање", wet_paint: "Мокро бојадисување",
  galvanizing: "Галванизација", cnc_machining: "ЦНЦ обработка", labor: "Работна рака",
  design: "Проектирање", transport: "Транспорт", installation: "Монтажа", other: "Други",
};
export const svcUnits: Record<string, string> = { m2: "м²", m: "м", kg: "кг", hour: "час", pcs: "ком", job: "посебно" };

export const prodCats: Record<string, string> = {
  laser_fence: "Ласер ЦНЦ ограда", decorative_fence: "Декоративна ограда", metal_fence: "Метална ограда",
  balcony_railing: "Балконски огради", stair_railing: "Скалилшни огради", gate: "Порта/Капија",
  pergola: "Пергола", canopy: "Надвес/Настрешница", metal_door: "Метална врата",
  industrial_product: "Индустриски производ", custom_metalwork: "Сопствен метален производ",
  shelf: "Полица", worktable: "Работна маса", other: "Други",
};
export const prodUnits: Record<string, string> = { m2: "м²", m: "м", kg: "кг", pcs: "ком", set: "комплет" };

export const matUnits: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л" };

