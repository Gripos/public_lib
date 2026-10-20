import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// Source folder resolution (highest priority first):
//   1. first CLI argument:  npm run sync -- "D:\path\to\vault"
//   2. COLLECTION_SRC env:  $env:COLLECTION_SRC = "D:\path"
//   3. built-in default
const DEFAULT_SRC = "D:\\Github\\MainObsidian\\6. Коллекции"
const cliArg = process.argv.slice(2).find((a) => !a.startsWith("-"))
const SRC = path.resolve(cliArg ?? process.env.COLLECTION_SRC ?? DEFAULT_SRC)
const CONTENT = path.join(repoRoot, "public_lib")
const DEST = path.join(CONTENT, "Коллекции")
// Covers live under content `static/` (copied to `public/static/`).
// Frontmatter keeps `cover: covers/<file>` — a path relative to `static/`,
// which is what og-image expects for `socialImage`/`cover` aliases.
const COVERS = path.join(CONTENT, "static", "covers")
const COVER_PREFIX = "covers/"

// Known-good mirror URLs when the primary cover host is unreachable
const COVER_FALLBACKS = {
  "https://modelmatic.uk/cdn/shop/files/8c19ca73fd334263bc9ce217424b456120250513014059025.jpg?v=1770550022":
    "https://cdn.shopify.com/s/files/1/0794/8543/6184/files/180ToyotaAE86SprinterTruenoKaidoStreetV1_1.jpg?v=1741011921",
}

function noteBaseSlug(name) {
  return name
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function stripDataviewJs(text) {
  const lines = text.split(/\r?\n/)
  const out = []
  let inBlock = false
  for (const line of lines) {
    if (!inBlock && line.trimStart().startsWith("```dataviewjs")) {
      inBlock = true
      continue
    }
    if (inBlock) {
      if (line.trim() === "```") inBlock = false
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

function ensureQuartzPropertiesFlag(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return text
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---")
  if (closing === -1) return text
  const fm = lines.slice(1, closing).join("\n")
  if (/^quartz-properties/m.test(fm)) return text
  lines.splice(1, 0, "quartz-properties: false")
  return lines.join("\n")
}

// Kaido House / Mini GT SKUs carry letters (KHMG180, MGT01207); the site
// shows only the numeric catalogue number.
const DIGITS_ONLY_BRANDS = new Set(["Kaido House", "Mini GT"])

function normalizeSku(content, frontmatter) {
  if (!frontmatter || !DIGITS_ONLY_BRANDS.has(frontmatter.model_brand)) {
    return { content, changed: false }
  }
  const m = content.match(/^sku:\s*["']?([^"'\n]+)["']?\s*$/m)
  if (!m) return { content, changed: false }
  const digits = m[1].replace(/\D/g, "")
  if (!digits || digits === m[1]) return { content, changed: false }
  return {
    content: content.replace(/^sku:.*$/m, `sku: ${digits}`),
    changed: true,
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  try {
    return YAML.parse(match[1])
  } catch {
    return null
  }
}

async function downloadCover(url, retries = 3) {
  let lastErr
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        redirect: "follow",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ct = (res.headers.get("content-type") ?? "").toLowerCase()
      const ext = ct.includes("webp")
        ? "webp"
        : ct.includes("png")
          ? "png"
          : ct.includes("gif")
            ? "gif"
            : "jpg"
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error("empty body")
      return { buf, ext }
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
  throw lastErr
}

async function localizeCover(content, name, usedCovers) {
  const m = content.match(/^cover:\s*(\S+)\s*$/m)
  if (!m) return { content, downloaded: false, failed: null }

  const base = noteBaseSlug(name)
  const existing = fs.existsSync(COVERS)
    ? fs.readdirSync(COVERS).find((f) => f.replace(/\.[^.]+$/, "") === base)
    : undefined

  const rewrite = (fname) => content.replace(/^cover:\s*\S+\s*$/m, `cover: ${COVER_PREFIX}${fname}`)

  if (/^https?:\/\//i.test(m[1])) {
    if (existing) {
      usedCovers.add(existing)
      return { content: rewrite(existing), downloaded: false, failed: null }
    }
    try {
      const primary = m[1]
      const fallback = COVER_FALLBACKS[primary]
      let downloaded
      try {
        downloaded = await downloadCover(primary, fallback ? 1 : 3)
      } catch (err) {
        if (!fallback) throw err
        console.warn(`Cover primary failed for ${name} (${err.message}), trying fallback`)
        downloaded = await downloadCover(fallback)
      }
      const { buf, ext } = downloaded
      const fname = `${base}.${ext}`
      fs.writeFileSync(path.join(COVERS, fname), buf)
      usedCovers.add(fname)
      return { content: rewrite(fname), downloaded: true, failed: null }
    } catch (err) {
      return { content, downloaded: false, failed: `${name}: ${err.message}` }
    }
  }

  // Already local: normalize to `static/covers/<file>` when the file is there
  if (existing && m[1] !== `${COVER_PREFIX}${existing}`) {
    usedCovers.add(existing)
    return { content: rewrite(existing), downloaded: false, failed: null }
  }
  if (existing) usedCovers.add(existing)
  return { content, downloaded: false, failed: null }
}

async function main() {
  console.log(`Collection sync: ${SRC}`)
  if (!fs.existsSync(SRC)) {
    console.error(`Source folder not found: ${SRC}`)
    console.error(
      `Set a different path with: npm run sync -- "<path>"  (or COLLECTION_SRC env var)`,
    )
    process.exit(1)
  }

  fs.mkdirSync(DEST, { recursive: true })
  fs.mkdirSync(COVERS, { recursive: true })

  const srcFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".md"))
  const copied = []
  const failures = []
  const usedCovers = new Set()
  let skippedWelly = 0
  let stripped = 0
  let downloads = 0
  let localized = 0
  let skuNormalized = 0

  const pending = []
  for (const name of srcFiles) {
    const original = fs.readFileSync(path.join(SRC, name), "utf-8")
    const frontmatter = parseFrontmatter(original)

    if (frontmatter?.model_brand === "Welly") {
      skippedWelly++
      continue
    }

    let content = stripDataviewJs(original)
    if (content !== original) stripped++
    content = ensureQuartzPropertiesFlag(content)
    const sku = normalizeSku(content, frontmatter)
    content = sku.content
    if (sku.changed) skuNormalized++

    copied.push(name)
    pending.push(
      (async () => {
        const res = await localizeCover(content, name, usedCovers)
        if (res.downloaded) downloads++
        if (res.content !== content) localized++
        if (res.failed) failures.push(res.failed)
        fs.writeFileSync(path.join(DEST, name), res.content, "utf-8")
      })(),
    )
  }
  await Promise.all(pending)

  console.log(
    `Collection sync: ${copied.length} copied, ${skippedWelly} Welly skipped, ${stripped} dataviewjs stripped`,
  )
  console.log(`SKU: ${skuNormalized} normalized to digits (Kaido House / Mini GT)`)
  console.log(`Covers: ${localized} localized (${downloads} downloaded), ${usedCovers.size} local`)
  console.log("Nothing is ever deleted by this script — remove stale files manually.")
  for (const f of failures) console.warn(`Cover download FAILED (kept remote): ${f}`)

  if (failures.length > 0) {
    console.error(`\nDone with ${failures.length} cover failure(s). Re-run to retry.`)
    process.exitCode = 1
  } else {
    console.log("\nDone. All covers local.")
  }
}

main().catch((err) => {
  console.error("Collection sync failed:", err?.stack ?? err)
  process.exitCode = 1
})
