import type { JSX } from "preact"
import { posix } from "node:path"
import type {
  BasesData,
  BasesEntry,
  FullSlug,
  ViewRenderer,
  ViewRendererProps,
  ViewTypeRegistration,
} from "@quartz-community/bases-page"
import { slugifyPath, transformLink } from "@quartz-community/bases-page"

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}){1,2}$/i
const WIKILINK_IMG_RE = /^\[\[(.+?)(?:\|.*)?\]\]$/
const NIL_VALUES = new Set(["нет", "no", "n/a", "none", "null", "-", "—"])

type PillStyle = { fg: string; bg: string }

type LinkCtx = {
  slug: FullSlug
  allSlugs: FullSlug[]
  linkResolution: "absolute" | "relative" | "shortest"
}

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

const COLUMN_LABEL_OVERRIDES: Record<string, string> = {
  "note.rating": "Рейтинг",
  rating: "Рейтинг",
  "note.genre": "Жанр",
  genre: "Жанр",
  "note.publisher": "Издательство",
  publisher: "Издательство",
  "note.author": "Автор",
  author: "Автор",
  "note.artist": "Исполнитель",
  artist: "Исполнитель",
  "note.date": "Дата",
  date: "Дата",
  "note.status": "Статус",
  status: "Статус",
  "note.tags": "Теги",
  tags: "Теги",
  "note.type": "Тип",
  type: "Тип",
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (segment === "") continue
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isNaN(index)) return undefined
      current = current[index]
      continue
    }
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[segment]
      continue
    }
    return undefined
  }
  return current
}

function resolveEntryPropertyValue(column: string, entry: BasesEntry): unknown {
  if (column.startsWith("note.")) {
    return getNestedValue(entry.properties, column.slice(5).split("."))
  }
  if (column.startsWith("file.")) {
    return getNestedValue(entry.fileProperties, column.slice(5).split("."))
  }
  if (column.startsWith("formula.")) {
    return getNestedValue(entry.formulaValues, column.slice(8).split("."))
  }
  return getNestedValue(entry.properties, column.split("."))
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true
  if (Array.isArray(value)) return value.length === 0
  return false
}

function isNilValue(value: unknown): boolean {
  if (isEmptyValue(value)) return true
  if (Array.isArray(value)) return value.filter((v) => !isNilValue(v)).length === 0
  return NIL_VALUES.has(String(value).trim().toLowerCase())
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => !isNilValue(v)).map(String)
  if (!isNilValue(value)) return [String(value)]
  return []
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ")
  if (value instanceof Date) return formatDate(value) ?? ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function getColumnLabel(column: string, basesData: BasesData): string {
  const override = COLUMN_LABEL_OVERRIDES[column]
  if (override) return override
  const config = basesData.properties?.[column]
  if (config?.displayName) return config.displayName
  const segment = column.split(".").pop() ?? column
  return segment
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ")
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

function entryTimestamp(entry: BasesEntry): number {
  const raw = resolveEntryPropertyValue("note.date", entry)
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === "string") {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function renderStars(rating: number): string {
  const full = Math.floor(rating / 2)
  const half = rating % 2 >= 1
  const empty = 5 - full - (half ? 1 : 0)
  return "🌕".repeat(full) + (half ? "🌗" : "") + "🌑".repeat(empty)
}

function resolveImageSrc(raw: string | undefined, ctx: LinkCtx): { src: string; isColor: boolean } {
  if (!raw) return { src: "", isColor: false }
  if (HEX_COLOR_RE.test(raw)) return { src: raw, isColor: true }
  const wikiMatch = WIKILINK_IMG_RE.exec(raw)
  if (wikiMatch?.[1]) {
    const target = wikiMatch[1].trim()
    const resolved = transformLink(ctx.slug, target, {
      strategy: ctx.linkResolution,
      allSlugs: ctx.allSlugs,
    })
    return { src: String(resolved), isColor: false }
  }
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("/")) {
    return { src: raw, isColor: false }
  }
  const fromStatic = raw.startsWith("static/") ? raw : `static/${raw}`
  const rel = posix.relative(posix.dirname(ctx.slug), fromStatic)
  return { src: rel.split(posix.sep).join("/"), isColor: false }
}

function StatusPill({ text }: { text: string }) {
  const style = STATUS_STYLES[text.toLowerCase()] ?? NEUTRAL
  return (
    <span class="review-pill" style={{ color: style.fg, backgroundColor: style.bg }}>
      {text}
    </span>
  )
}

function TagLinks({ value, ctx }: { value: unknown; ctx: LinkCtx }) {
  const tags = asArray(value)
  if (tags.length === 0) return null
  return (
    <span class="review-tags">
      {tags.map((tag, index) => {
        const slug = slugifyPath(tag)
        const href = transformLink(ctx.slug, `tags/${slug}`, {
          strategy: ctx.linkResolution,
          allSlugs: ctx.allSlugs,
        })
        return (
          <span key={tag}>
            {index > 0 && <span class="review-tag-sep">, </span>}
            <a href={href} class="internal internal-link review-tag">
              #{tag}
            </a>
          </span>
        )
      })}
    </span>
  )
}

function renderMetaValue(column: string, value: unknown, ctx: LinkCtx): JSX.Element {
  const key = column.split(".").pop() ?? column
  if (key === "rating") {
    const rating = Number(value)
    if (Number.isFinite(rating)) {
      return (
        <span class="review-rating">
          <span class="review-stars">{renderStars(rating)}</span>{" "}
          <span class="review-rating-num">({rating}/10)</span>
        </span>
      )
    }
  }
  if (key === "date" || key === "purchaseDate" || key === "publishedDate") {
    return <span>{formatDate(value) ?? formatValue(value)}</span>
  }
  if (key === "status") {
    const statuses = asArray(value)
    if (statuses.length > 0) {
      return (
        <span class="review-statuses">
          {statuses.map((status) => (
            <StatusPill key={status} text={status} />
          ))}
        </span>
      )
    }
  }
  if (key === "tags") {
    return <TagLinks value={value} ctx={ctx} />
  }
  if (value instanceof Date) {
    return <span>{formatDate(value)}</span>
  }
  return <span>{formatValue(value)}</span>
}

function Card({ entry, props }: { entry: BasesEntry; props: ViewRendererProps }) {
  const { view, basesData, slug, allSlugs, linkResolution } = props
  const imageProperty = typeof view.image === "string" ? view.image : undefined
  const cardMetaColumns =
    view.order && view.order.length > 0
      ? view.order.filter((column) => column !== imageProperty && column !== "file.name")
      : []
  const aspectRatio = view.imageAspectRatio ?? view.cardAspect
  const imageFit = view.imageFit === "cover" ? "cover" : "contain"
  const imageAspect =
    typeof aspectRatio === "number" && aspectRatio > 0
      ? { aspectRatio: String(aspectRatio) }
      : undefined
  const linkCtx: LinkCtx = {
    slug: slug as FullSlug,
    allSlugs: allSlugs as FullSlug[],
    linkResolution,
  }
  const imageValue = imageProperty ? resolveEntryPropertyValue(imageProperty, entry) : undefined
  const rawImage = imageValue ? String(imageValue) : ""
  const { src: imageSrc, isColor } = resolveImageSrc(rawImage, linkCtx)
  const href = transformLink(slug as FullSlug, entry.slug as FullSlug, {
    strategy: linkResolution,
    allSlugs: allSlugs as FullSlug[],
  })

  return (
    <a href={href} class="internal internal-link bases-card review-card" data-slug={entry.slug}>
      {imageSrc && !isColor && (
        <div class="bases-card-image" style={imageAspect}>
          <img
            src={imageSrc}
            alt={entry.title}
            loading="lazy"
            referrerpolicy="no-referrer"
            style={{ objectFit: imageFit }}
          />
        </div>
      )}
      {imageSrc && isColor && (
        <div
          class="bases-card-image bases-card-color"
          style={{ ...imageAspect, backgroundColor: imageSrc }}
        />
      )}
      <div class="bases-card-body">
        <span class="bases-card-title">{entry.title}</span>
        <div class="bases-card-meta">
          {cardMetaColumns.map((column) => {
            const value = resolveEntryPropertyValue(column, entry)
            if (isNilValue(value)) return null
            return (
              <div class="bases-card-row">
                <span class="bases-card-label">{getColumnLabel(column, basesData)}</span>
                <span class="bases-card-value">{renderMetaValue(column, value, linkCtx)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </a>
  )
}

const ReviewCardsView: ViewRenderer = (props) => {
  const { entries, view, total } = props
  const groupProperty = view.groupBy?.property ?? view.boardProperty
  const cardSize = view.cardSize
  const gridStyle =
    typeof cardSize === "number" && cardSize > 0
      ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }
      : { gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }
  const emptyLabel = "Без категории"

  const groups: { label: string; entries: BasesEntry[] }[] = []
  const groupIndex = new Map<string, number>()

  for (const entry of entries) {
    let label = ""
    if (groupProperty) {
      const rawValue = resolveEntryPropertyValue(groupProperty, entry)
      label = isEmptyValue(rawValue) ? emptyLabel : formatValue(rawValue)
    }
    const existing = groupIndex.get(label)
    if (existing === undefined) {
      groupIndex.set(label, groups.length)
      groups.push({ label, entries: [entry] })
    } else {
      groups[existing].entries.push(entry)
    }
  }

  if (groupProperty && view.groupBy?.direction === "DESC") {
    groups.sort((a, b) => b.label.localeCompare(a.label))
  } else if (groupProperty) {
    groups.sort((a, b) => a.label.localeCompare(b.label))
  }

  for (const group of groups) {
    group.entries.sort((a, b) => {
      const diff = entryTimestamp(b) - entryTimestamp(a)
      if (diff !== 0) return diff
      return a.title.localeCompare(b.title)
    })
  }

  const showHeaders = Boolean(groupProperty)

  return (
    <div class="review-cards-wrapper">
      <div class="bases-view-meta" data-total={total}>
        Показано {entries.length} из {total} обзоров
      </div>
      {groups.map((group) => (
        <section class="review-cards-group" data-category={group.label}>
          {showHeaders && (
            <h3 class="review-cards-group-title">
              <span>{group.label}</span>
              <span class="review-cards-group-count">{group.entries.length}</span>
            </h3>
          )}
          <div class="bases-cards review-cards" style={gridStyle}>
            {group.entries.map((entry) => (
              <Card entry={entry} props={props} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export const reviewCardsRegistration: ViewTypeRegistration = {
  id: "review-cards",
  name: "Обзоры",
  icon: "layout-grid",
  render: ReviewCardsView,
  css: `
.review-cards-wrapper { display: flex; flex-direction: column; gap: 1.2rem; }
.review-cards-group { display: flex; flex-direction: column; gap: 0.7rem; }
.review-cards-group + .review-cards-group { margin-top: 1rem; }
.review-cards-group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  border-bottom: 2px solid var(--lightgray, #e5e5e5);
  padding-bottom: 0.35rem;
}
.review-cards-group-count {
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--lightgray, #e5e5e5);
  color: var(--darkgray, #4e4e4e);
  border-radius: 9999px;
  padding: 0.1rem 0.55rem;
}
.review-cards { display: grid; gap: 1rem; align-items: start; justify-content: start; }
.review-cards .review-card { height: 100%; }
.review-cards .review-card .bases-card-image { width: 100%; background: var(--lightgray, #e5e5e5); }
.review-cards .review-card .bases-card-image img { width: 100%; height: 100%; object-fit: contain; }
.review-cards .review-card .bases-card-body { padding: 0.85rem 1rem; gap: 0.45rem; }
.review-cards .review-card .bases-card-title { font-size: 1.02rem; line-height: 1.3; }
.review-cards .review-card .bases-card-meta { gap: 0.3rem; }
.review-cards .review-card .bases-card-row { font-size: 0.82rem; gap: 0.5rem; align-items: baseline; }
.review-cards .review-card .bases-card-label { flex: 0 0 auto; }
.review-cards .review-card .bases-card-value { text-align: right; }
.review-rating { white-space: nowrap; }
.review-stars { letter-spacing: 0.03em; }
.review-rating-num { color: var(--gray, #b8b8b8); }
.review-statuses { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; justify-content: flex-end; }
.review-pill {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.76rem;
  font-weight: 600;
  white-space: nowrap;
}
.review-tags { display: inline-flex; flex-wrap: wrap; gap: 0.1rem 0.25rem; justify-content: flex-end; }
.review-tag { color: var(--secondary, #284b63); text-decoration: none; }
.review-tag:hover { text-decoration: underline; }
.review-tag-sep { color: var(--gray, #b8b8b8); }
`,
}
