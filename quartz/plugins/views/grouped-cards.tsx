import type { JSX } from "preact"
import { posix } from "node:path"
import type { FullSlug } from "@quartz-community/bases-page"
import type {
  BasesData,
  BasesEntry,
  ViewRenderer,
  ViewRendererProps,
  ViewTypeRegistration,
} from "@quartz-community/bases-page"
import { slugifyPath, transformLink, viewRegistry } from "@quartz-community/bases-page"

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}){1,2}$/i
const WIKILINK_IMG_RE = /^\[\[(.+?)(?:\|.*)?\]\]$/
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
const MDLINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g
const URL_RE = /https?:\/\/[^\s<>]+/g

type LinkCtx = {
  slug: FullSlug
  allSlugs: FullSlug[]
  linkResolution: "absolute" | "relative" | "shortest"
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

const NIL_VALUES = new Set(["нет", "no", "n/a", "none", "null", "-", "—"])

// Placeholder-ish values used in collection notes to mean "no real value"
function isNilValue(value: unknown): boolean {
  if (isEmptyValue(value)) return true
  if (Array.isArray(value)) return value.filter((v) => !isNilValue(v)).length === 0
  return NIL_VALUES.has(String(value).trim().toLowerCase())
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

const COLUMN_LABEL_OVERRIDES: Record<string, string> = {
  "note.sku": "Номер",
  sku: "Номер",
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

function isFileValue(
  value: unknown,
): value is { name: string; basename: string; path: string; folder: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === "string" &&
    typeof record.basename === "string" &&
    typeof record.path === "string" &&
    typeof record.folder === "string"
  )
}

function renderTextWithLinks(text: string, ctx: LinkCtx): (string | JSX.Element)[] {
  const segments: { start: number; end: number; node: JSX.Element }[] = []
  const transformOpts = { strategy: ctx.linkResolution, allSlugs: ctx.allSlugs }

  for (const match of text.matchAll(WIKILINK_RE)) {
    const target = match[1] ?? ""
    const display = match[2] ?? target
    const href = transformLink(ctx.slug, target, transformOpts)
    segments.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      node: (
        <a href={href} class="internal internal-link">
          {display}
        </a>
      ),
    })
  }
  for (const match of text.matchAll(MDLINK_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (segments.some((segment) => start < segment.end && end > segment.start)) continue
    const display = match[1] ?? ""
    const href = match[2] ?? ""
    const isExternal = href.startsWith("http://") || href.startsWith("https://")
    const resolvedHref = isExternal ? href : String(transformLink(ctx.slug, href, transformOpts))
    segments.push({
      start,
      end,
      node: (
        <a
          href={resolvedHref}
          class={isExternal ? "external external-link" : "internal internal-link"}
          {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {display || href}
        </a>
      ),
    })
  }
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (segments.some((segment) => start < segment.end && end > segment.start)) continue
    segments.push({
      start,
      end,
      node: (
        <a href={match[0]} class="external external-link" target="_blank" rel="noopener noreferrer">
          {match[0]}
        </a>
      ),
    })
  }

  if (segments.length === 0) return [text]
  segments.sort((a, b) => a.start - b.start)
  const result: (string | JSX.Element)[] = []
  let cursor = 0
  for (const segment of segments) {
    if (segment.start > cursor) result.push(text.slice(cursor, segment.start))
    result.push(segment.node)
    cursor = segment.end
  }
  if (cursor < text.length) result.push(text.slice(cursor))
  return result
}

function renderCellValue(value: unknown, ctx: LinkCtx): JSX.Element {
  if (value === null || value === undefined) {
    return <span class="bases-empty">—</span>
  }
  if (typeof value === "boolean") {
    return <input type="checkbox" checked={value} disabled />
  }
  if (typeof value === "number") {
    return <span class="bases-number">{value}</span>
  }
  if (typeof value === "string") {
    return <span class="bases-text">{renderTextWithLinks(value, ctx)}</span>
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => (
      <>
        {index > 0 && <span class="bases-separator">, </span>}
        {renderCellValue(item, ctx)}
      </>
    ))
    return <span class="bases-list">{items}</span>
  }
  if (typeof value === "object") {
    if (isFileValue(value)) {
      const href = transformLink(ctx.slug, slugifyPath(value.path.replace(/\.md$/, "")), {
        strategy: ctx.linkResolution,
        allSlugs: ctx.allSlugs,
      })
      return (
        <a href={href} class="internal internal-link">
          {value.basename}
        </a>
      )
    }
    return <code>{JSON.stringify(value)}</code>
  }
  return <span>{String(value)}</span>
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
  // frontmatter cover is relative to `static/`
  const fromStatic = raw.startsWith("static/") ? raw : `static/${raw}`
  const rel = posix.relative(posix.dirname(ctx.slug), fromStatic)
  return { src: rel.split(posix.sep).join("/"), isColor: false }
}

function Card({
  entry,
  props,
  brand,
}: {
  entry: BasesEntry
  props: ViewRendererProps
  brand?: string
}) {
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
  const skuRaw = resolveEntryPropertyValue("note.sku", entry)
  const sku = isNilValue(skuRaw) ? "" : formatValue(skuRaw)

  return (
    <a
      href={href}
      class="internal internal-link bases-card"
      data-slug={entry.slug}
      data-sku={sku}
      data-brand={brand ?? ""}
    >
      {imageSrc && !isColor && (
        <div class="bases-card-image">
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
                <span class="bases-card-value">{renderCellValue(value, linkCtx)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </a>
  )
}

function skuSortKey(value: unknown): string {
  return isNilValue(value) ? "" : formatValue(value)
}

function compareSku(a: BasesEntry, b: BasesEntry): number {
  const aRaw = skuSortKey(resolveEntryPropertyValue("note.sku", a))
  const bRaw = skuSortKey(resolveEntryPropertyValue("note.sku", b))
  const aNum = /^\d+$/.test(aRaw) ? Number(aRaw) : null
  const bNum = /^\d+$/.test(bRaw) ? Number(bRaw) : null
  if (aNum !== null && bNum !== null) return aNum - bNum
  if (aNum !== null) return -1
  if (bNum !== null) return 1
  return aRaw.localeCompare(bRaw, undefined, { numeric: true, sensitivity: "base" })
}

const GroupedCardsView: ViewRenderer = (props) => {
  const { entries, view, total, locale } = props
  const groupProperty = view.groupBy?.property ?? view.boardProperty
  const cardSize = view.cardSize
  const gridStyle =
    typeof cardSize === "number" && cardSize > 0
      ? { gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))` }
      : { gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }

  const groups: { label: string; entries: BasesEntry[] }[] = []
  const groupIndex = new Map<string, number>()
  const emptyLabel = locale.startsWith("ru") ? "Без бренда" : "Uncategorized"

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
  }

  for (const group of groups) {
    group.entries.sort(compareSku)
  }

  const showHeaders = Boolean(groupProperty) && groups.length > 1
  const hasFilters = groupProperty && groups.length > 1

  return (
    <div class="bases-cards-wrapper">
      {hasFilters && (
        <div class="bases-cards-controls">
          <div class="bases-cards-brands" role="group" aria-label="Фильтр по маркам">
            {groups.map((group) => (
              <button
                type="button"
                class="bases-brand-toggle is-active"
                data-brand-target={group.label}
                aria-pressed="true"
              >
                {group.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            class="bases-sku-search"
            placeholder="Поиск по номеру…"
            aria-label="Поиск по номеру"
          />
        </div>
      )}
      <div class="bases-view-meta" data-total={total}>
        Показано {entries.length} из {total} моделей
      </div>
      {groups.map((group) => (
        <section class="bases-card-group" data-brand={group.label}>
          {showHeaders && (
            <h3 class="bases-card-group-title">
              <span>{group.label}</span>
              <span class="bases-card-group-count">{group.entries.length}</span>
            </h3>
          )}
          <div class="bases-cards" style={gridStyle}>
            {group.entries.map((entry) => (
              <Card entry={entry} props={props} brand={group.label} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export const groupedCardsRegistration: ViewTypeRegistration = {
  id: "grouped-cards",
  name: "Витрина",
  icon: "layout-grid",
  render: GroupedCardsView,
  css: `
.bases-cards-controls { display: flex; flex-direction: column; gap: 0.6rem; }
.bases-cards-brands { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.bases-brand-toggle {
  border: 1px solid var(--lightgray, #e5e5e5);
  background: var(--light, #fff);
  color: var(--darkgray, #4e4e4e);
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.bases-brand-toggle:hover { border-color: var(--secondary, #284b63); }
.bases-brand-toggle.is-active {
  background: var(--secondary, #284b63);
  color: var(--light, #fff);
  border-color: var(--secondary, #284b63);
}
.bases-sku-search {
  width: 100%;
  max-width: 320px;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--lightgray, #e5e5e5);
  border-radius: 9999px;
  background: var(--light, #fff);
  color: var(--dark, #000);
  font-size: 0.9rem;
}
.bases-sku-search:focus {
  outline: none;
  border-color: var(--secondary, #284b63);
}
.bases-card[hidden], .bases-card-group[hidden] { display: none; }
.bases-card-group { display: flex; flex-direction: column; gap: 0.6rem; }
.bases-card-group + .bases-card-group { margin-top: 1.6rem; }
.bases-card-group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  border-bottom: 2px solid var(--lightgray, #e5e5e5);
  padding-bottom: 0.35rem;
}
.bases-card-group-count {
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--lightgray, #e5e5e5);
  color: var(--darkgray, #4e4e4e);
  border-radius: 9999px;
  padding: 0.1rem 0.55rem;
}
.bases-cards .bases-card {
  flex-direction: row;
  align-items: stretch;
  height: var(--bases-card-height, 133px);
}
.bases-cards .bases-card-image {
  flex: 0 0 45%;
  width: 45%;
  min-width: 45%;
  height: var(--bases-card-height, 133px);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}
.bases-cards .bases-card-image img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}
.bases-cards .bases-card-body {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--bases-card-height, 133px);
  box-sizing: border-box;
  overflow: hidden;
  justify-content: start;
}
.bases-cards .bases-card-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.35;
  min-height: 2.7em;
}
.bases-cards .bases-card-meta { align-content: start; }
.bases-cards .bases-card-row { min-height: 1.2rem; }
.bases-cards { justify-content: start; }
@media (max-width: 480px) {
  .bases-cards .bases-card { flex-direction: column; height: auto; }
  .bases-cards .bases-card-image { flex-basis: auto; width: 100%; min-width: 100%; }
}
`,
  afterDOMLoaded: `
(function () {
  var TEARDOWN = [];
  function initWrapper(wrapper) {
    var brands = Array.prototype.slice.call(wrapper.querySelectorAll(".bases-card-group"));
    var toggles = Array.prototype.slice.call(wrapper.querySelectorAll(".bases-brand-toggle"));
    var search = wrapper.querySelector(".bases-sku-search");
    var meta = wrapper.querySelector(".bases-view-meta");
    if (toggles.length === 0) return;
    var total = meta ? parseInt(meta.getAttribute("data-total") || "0", 10) : 0;

    var activeSet = {};
    toggles.forEach(function (btn) {
      activeSet[btn.getAttribute("data-brand-target") || ""] = true;
    });
    var query = "";

    function apply() {
      var visible = 0;
      brands.forEach(function (section) {
        var brand = section.getAttribute("data-brand") || "";
        var brandOn = activeSet[brand] !== false;
        var cards = Array.prototype.slice.call(section.querySelectorAll(".bases-card"));
        var shown = 0;
        cards.forEach(function (card) {
          var sku = (card.getAttribute("data-sku") || "").toLowerCase();
          var matches = query === "" || sku.indexOf(query) !== -1;
          var show = brandOn && matches;
          card.hidden = !show;
          if (show) shown++;
        });
        section.hidden = !brandOn || shown === 0;
        var count = section.querySelector(".bases-card-group-count");
        if (count) count.textContent = String(shown);
        visible += shown;
      });
      if (meta) meta.textContent = "Показано " + visible + " из " + total + " моделей";
    }

    toggles.forEach(function (btn) {
      var handler = function () {
        var key = btn.getAttribute("data-brand-target") || "";
        activeSet[key] = activeSet[key] === false;
        btn.classList.toggle("is-active", activeSet[key] !== false);
        btn.setAttribute("aria-pressed", activeSet[key] !== false ? "true" : "false");
        apply();
      };
      btn.addEventListener("click", handler);
      TEARDOWN.push(function () { btn.removeEventListener("click", handler); });
    });

    if (search) {
      var onInput = function () {
        query = (search.value || "").trim().toLowerCase();
        apply();
      };
      search.addEventListener("input", onInput);
      TEARDOWN.push(function () { search.removeEventListener("input", onInput); });
    }

    apply();
  }

  function run() {
    TEARDOWN.forEach(function (fn) { fn(); });
    TEARDOWN = [];
    var wrappers = document.querySelectorAll(
      '.bases-view[data-view-type="grouped-cards"] .bases-cards-wrapper'
    );
    wrappers.forEach(function (wrapper) { initWrapper(wrapper); });
  }

  document.addEventListener("nav", run);
  document.addEventListener("render", run);
  if (document.readyState !== "loading") run();
  else document.addEventListener("DOMContentLoaded", run);
})();
`,
}

const TableDescView: ViewRenderer = (props) => {
  const builtin = viewRegistry.get("table")
  if (!builtin) {
    return <div class="bases-empty">Table view unavailable</div>
  }

  const { view, entries } = props
  const groupProperty = view.groupBy?.property ?? view.boardProperty
  if (!groupProperty || view.groupBy?.direction !== "DESC") {
    return builtin.render(props)
  }

  const groups = new Map<string, BasesEntry[]>()
  for (const entry of entries) {
    const rawValue = resolveEntryPropertyValue(groupProperty, entry)
    const label = isEmptyValue(rawValue) ? "" : formatValue(rawValue)
    const bucket = groups.get(label)
    if (bucket) {
      bucket.push(entry)
    } else {
      groups.set(label, [entry])
    }
  }
  const reordered = [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([, groupEntries]) => groupEntries)
  return builtin.render({ ...props, entries: reordered })
}

export const tableDescRegistration: ViewTypeRegistration = {
  id: "table-desc",
  name: "Каталог",
  icon: "table",
  render: TableDescView,
}
