import { fromHtml } from "hast-util-from-html"
import { visit } from "unist-util-visit"
import { QuartzTransformerPlugin } from "../types"

type PillStyle = { fg: string; bg: string }

const REVIEW_DIR = "Обзоры/"

const STATUS_STYLES: Record<string, PillStyle> = {
  планирую: { fg: "#3b82f6", bg: "#dbeafe" },
  играю: { fg: "#f59e0b", bg: "#fef3c7" },
  прохожу: { fg: "#f59e0b", bg: "#fef3c7" },
  слушаю: { fg: "#f59e0b", bg: "#fef3c7" },
  смотрю: { fg: "#f59e0b", bg: "#fef3c7" },
  читаю: { fg: "#f59e0b", bg: "#fef3c7" },
  пройдено: { fg: "#16a34a", bg: "#dcfce7" },
  прочитано: { fg: "#16a34a", bg: "#dcfce7" },
  просмотрено: { fg: "#16a34a", bg: "#dcfce7" },
  прослушано: { fg: "#16a34a", bg: "#dcfce7" },
  брошено: { fg: "#6b7280", bg: "#e5e7eb" },
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

function dateLabel(type: string): string {
  switch (type) {
    case "Игры":
      return "Дата прохождения"
    case "Книги":
    case "Комиксы":
      return "Дата прочтения"
    case "Фильмы":
    case "Сериалы":
      return "Дата просмотра"
    case "Песни":
      return "Дата прослушивания"
    default:
      return "Дата"
  }
}

function coverSrc(cover: string): string {
  if (!cover) return ""
  if (/^(https?:)?\/\//i.test(cover) || cover.startsWith("data:") || cover.startsWith("/")) {
    return cover
  }
  return cover.startsWith("static/") ? cover : `static/${cover}`
}

function reviewCardHtml(fm: Record<string, unknown>, title: string): string {
  const type = fm.type ? String(fm.type) : ""
  const cover = coverSrc(fm.cover ? String(fm.cover) : "")
  const publisher = fm.publisher ? String(fm.publisher) : fm.author ? String(fm.author) : ""
  const publisherLabel = fm.publisher ? "Издательство" : "Автор"
  const genre = fm.genre ? String(fm.genre) : ""
  const rating = Number(fm.rating)
  const hasRating = Number.isFinite(rating) && rating > 0
  const date = formatDate(fm.date)
  const tags = asArray(fm.tags)
  const status = asArray(fm.status)[0] ?? ""
  const statusStyle = STATUS_STYLES[status.toLowerCase()] ?? NEUTRAL

  const coverHtml = cover
    ? `<div style="flex-shrink:0;"><img src="${esc(cover)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer" style="max-width: 200px; width: 100%; height: auto; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,0.25);"></div>`
    : ""

  const details: string[] = []
  if (publisher) {
    details.push(`<p style="margin: 0;"><strong>${publisherLabel}: </strong>${esc(publisher)}</p>`)
  }
  if (genre) {
    details.push(`<p style="margin: 0;"><strong>Жанр: </strong>${esc(genre)}</p>`)
  }
  if (hasRating) {
    details.push(
      `<p style="margin: 0;"><strong>Рейтинг: </strong>${renderStars(rating)} (${rating}/10)</p>`,
    )
  }
  if (date) {
    details.push(`<p style="margin: 0;"><strong>${dateLabel(type)}: </strong>${esc(date)}</p>`)
  }
  if (tags.length > 0) {
    details.push(
      `<p style="margin: 0;"><strong>Теги: </strong>${tags.map((t) => `#${esc(t)}`).join(", ")}</p>`,
    )
  }
  if (status) {
    details.push(`<p style="margin: 0;"><strong>Статус: </strong>${pill(status, statusStyle)}</p>`)
  }

  return `<div class="review-card-detail" style="display: flex; align-items: flex-start; gap: 1rem; margin: 1em 0; flex-wrap: wrap;">${coverHtml}<div style="flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 0.3rem; line-height: 1.35;">${details.join("")}</div></div>`
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

export const ReviewCard: QuartzTransformerPlugin = () => ({
  name: "ReviewCard",
  htmlPlugins: () => [
    () => (tree, file) => {
      const relativePath = String(file.data.relativePath ?? "")
      if (!relativePath.startsWith(REVIEW_DIR)) return

      const fm = file.data.frontmatter as Record<string, unknown> | undefined
      if (!fm?.type) return

      removeDataviewJsBlocks(tree)

      const title =
        (typeof fm.title === "string" && fm.title) ||
        (typeof file.data.title === "string" && file.data.title) ||
        String(file.data.slug ?? "")
          .split("/")
          .pop() ||
        ""
      const fragment = fromHtml(reviewCardHtml(fm, title), {
        fragment: true,
      })
      ;(tree as { children: unknown[] }).children.unshift(...fragment.children)
    },
  ],
})
