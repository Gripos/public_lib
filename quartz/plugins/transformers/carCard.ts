import { fromHtml } from "hast-util-from-html"
import { h } from "preact"
import { visit } from "unist-util-visit"
import { QuartzTransformerPlugin } from "../types"

type PillStyle = { fg: string; bg: string }

const BRAND_STYLES: Record<string, PillStyle> = {
  "mini gt": { fg: "#1d4ed8", bg: "#dbeafe" },
  "kaido house": { fg: "#c2410c", bg: "#ffedd5" },
  "hot wheels": { fg: "#b91c1c", bg: "#fee2e2" },
}

const STATUS_STYLES: Record<string, PillStyle> = {
  "в коллекции": { fg: "#16a34a", bg: "#dcfce7" },
  заказано: { fg: "#3b82f6", bg: "#dbeafe" },
  "в пути": { fg: "#f59e0b", bg: "#fef3c7" },
  продано: { fg: "#6b7280", bg: "#e5e7eb" },
}

const CONDITION_STYLES: Record<string, PillStyle> = {
  анпак: { fg: "#6b7280", bg: "#e5e7eb" },
  sealed: { fg: "#6b7280", bg: "#e5e7eb" },
  распак: { fg: "#16a34a", bg: "#dcfce7" },
  открыта: { fg: "#16a34a", bg: "#dcfce7" },
  "б/у": { fg: "#c2410c", bg: "#ffedd5" },
  "б/у.": { fg: "#c2410c", bg: "#ffedd5" },
}

const NEUTRAL: PillStyle = { fg: "#6b7280", bg: "#e5e7eb" }

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== "").map(String)
  if (value != null && value !== "") return [String(value)]
  return []
}

function pill(text: string, style: PillStyle): string {
  return `<span style="display:inline-block; padding: 0.15rem 0.55rem; border-radius: 9999px; font-size: 0.78rem; font-weight: 600; color: ${style.fg}; background-color: ${style.bg}; vertical-align: middle; white-space: nowrap;">${esc(text)}</span>`
}

function renderStars(rating: number): string {
  const full = Math.floor(rating / 2)
  const half = rating % 2 >= 1
  const empty = 5 - full - (half ? 1 : 0)
  return "🌕".repeat(full) + (half ? "🌗" : "") + "🌑".repeat(empty)
}

function formatDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date && !isNaN(value.getTime())) {
    const dd = String(value.getDate()).padStart(2, "0")
    const mm = String(value.getMonth() + 1).padStart(2, "0")
    return `${dd}.${mm}.${value.getFullYear()}`
  }
  const str = String(value)
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`
  return str
}

function colorSwatch(color: string): string {
  if (!/^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i.test(color)) return ""
  return `<span style="display:inline-block; width:0.8rem; height:0.8rem; border-radius:50%; background:${esc(color)}; border:1px solid rgba(0,0,0,0.25); margin-right:0.35rem; vertical-align:middle;"></span>`
}

function coverSrc(cover: string): string {
  if (!cover) return ""
  if (
    /^(https?:)?\/\//i.test(cover) ||
    cover.startsWith("data:") ||
    cover.startsWith("/") ||
    cover.startsWith("static/")
  ) {
    return cover
  }
  // frontmatter cover is relative to `static/`
  return `static/${cover}`
}

function carCardHtml(fm: Record<string, unknown>, title: string): string {
  const cover = coverSrc(fm.cover ? String(fm.cover) : "")
  const brand = fm.model_brand ? String(fm.model_brand) : "Бренд не указан"
  const brandKey = brand.toLowerCase()
  const brandStyle = BRAND_STYLES[brandKey] ?? NEUTRAL
  const make = fm.car_brand ? String(fm.car_brand) : ""
  const model = fm.model ? String(fm.model) : ""
  const country = fm.country ? String(fm.country) : ""
  const scale = fm.scale ? String(fm.scale) : ""
  const color = fm.color ? String(fm.color) : ""
  const series = fm.series ? String(fm.series) : ""
  const sku = fm.sku ? String(fm.sku) : ""
  const bodyStyle = fm.bodyStyle ? String(fm.bodyStyle) : ""
  const store = fm.store ? String(fm.store) : ""
  const rating = typeof fm.rating === "number" ? fm.rating : 0
  const tags = asArray(fm.tags)
  const status = (asArray(fm.status)[0] ?? "неизвестно").toLowerCase()
  const condition = (asArray(fm.condition)[0] ?? "").toLowerCase()
  const statusStyle = STATUS_STYLES[status] ?? NEUTRAL
  const conditionStyle = CONDITION_STYLES[condition] ?? NEUTRAL
  const date = formatDate(fm.purchaseDate)
  const price = fm.price != null && fm.price !== "" ? String(fm.price) : ""

  const coverHtml = cover
    ? `<div style="flex-shrink:0;"><img src="${esc(cover)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer" style="max-width: 280px; width: 100%; height: auto; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,0.25);"></div>`
    : ""

  const metaGeo = [country, scale].filter(Boolean).join(" · ")
  const metaSeries = [series, sku].filter(Boolean).join(" · ")
  const colorLine = [color, bodyStyle].filter(Boolean).join(" · ")
  const conditionHtml = condition ? pill(condition, conditionStyle) : ""

  let purchaseLine = ""
  if (price) {
    purchaseLine = `${date ? `<strong>Куплена: </strong>${esc(date)}, ` : ""}<strong>Цена: </strong>${esc(price)} ₽${store ? `, ${esc(store)}` : ""}`
  } else if (date) {
    purchaseLine = `<strong>Куплена: </strong>${esc(date)}${store ? `, ${esc(store)}` : ""}`
  }

  const details: string[] = []
  if (make || model) {
    details.push(
      `<p style="margin: 0;"><strong>${make ? esc(make) : "Марка не указана"}</strong>${make && model ? " · " : ""}${model ? esc(model) : ""}</p>`,
    )
  }
  if (metaGeo) {
    details.push(
      `<p style="margin: 0;">${country ? `<strong>Страна: </strong>${esc(country)} · ` : ""}${esc(scale)}</p>`,
    )
  }
  if (metaSeries) {
    details.push(
      `<p style="margin: 0;"><strong>Серия: </strong>${series ? esc(series) : ""}${series && sku ? " · " : ""}${sku ? `<strong>Артикул: </strong>${esc(sku)}` : ""}</p>`,
    )
  }
  if (colorLine) {
    details.push(
      `<p style="margin: 0;">${colorSwatch(color)}${esc(colorLine)}${conditionHtml ? ` · ${conditionHtml}` : ""}</p>`,
    )
  } else if (conditionHtml) {
    details.push(`<p style="margin: 0;">${conditionHtml}</p>`)
  }
  details.push(`<p style="margin: 0;">${pill(status, statusStyle)}</p>`)
  if (purchaseLine) {
    details.push(`<p style="margin: 0;">${purchaseLine}</p>`)
  }
  if (rating > 0) {
    details.push(`<p style="margin: 0;">${renderStars(rating)} (${rating}/10)</p>`)
  }
  if (tags.length > 0) {
    details.push(`<p style="margin: 0;">${tags.map((t) => `#${esc(t)}`).join(" · ")}</p>`)
  }

  return `<div class="car-card" style="display: flex; align-items: flex-start; gap: 1rem; margin: 1em 0; flex-wrap: wrap;">${coverHtml}<div style="flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 0.3rem; line-height: 1.35;"><h3 style="margin: 0 0 0.2rem 0;">${esc(title)} ${pill(brand, brandStyle)}</h3>${details.join("")}</div></div>`
}

function removeDataviewJsBlocks(tree: unknown) {
  visit(tree as never, "element", (node: any, index: number | undefined, parent: any) => {
    if (!parent || index === undefined || node.tagName !== "pre") return
    const code = node.children?.find((c: any) => c.type === "element" && c.tagName === "code")
    if (!code) return
    const className = Array.isArray(code.properties?.className) ? code.properties.className : []
    if (className.some((c: unknown) => String(c).includes("dataviewjs"))) {
      parent.children.splice(index, 1)
      return index
    }
  })
}

export const CarCard: QuartzTransformerPlugin = () => ({
  name: "CarCard",
  externalResources: () => ({
    additionalHead: [
      h("meta", { key: "referrer-no-referrer", name: "referrer", content: "no-referrer" }),
    ],
  }),
  htmlPlugins: () => [
    () => (tree, file) => {
      const fm = file.data.frontmatter as Record<string, unknown> | undefined
      if (!fm?.model_brand) return

      removeDataviewJsBlocks(tree)

      const title =
        (typeof fm.title === "string" && fm.title) ||
        (typeof file.data.title === "string" && file.data.title) ||
        String(file.data.slug ?? "")
      const fragment = fromHtml(carCardHtml(fm, title), { fragment: true })
      ;(tree as { children: unknown[] }).children.unshift(...fragment.children)
    },
  ],
})
