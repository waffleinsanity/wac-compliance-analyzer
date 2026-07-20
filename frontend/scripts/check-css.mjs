/**
 * Compiles frontend/src/index.css through PostCSS + Tailwind.
 * Fails hard if any @apply / theme utility is missing — so Vite never
 * surfaces a broken CSS overlay after the app already started.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const cssPath = path.join(root, 'src', 'index.css')

const postcss = require('postcss')
const tailwindcss = require('tailwindcss')
const autoprefixer = require('autoprefixer')

async function main() {
  if (!fs.existsSync(cssPath)) {
    console.error(`[check-css] Missing ${cssPath}`)
    process.exit(1)
  }

  const css = fs.readFileSync(cssPath, 'utf8')
  const configPath = path.join(root, 'tailwind.config.js')

  try {
    const result = await postcss([
      tailwindcss({ config: configPath }),
      autoprefixer(),
    ]).process(css, { from: cssPath })

    if (!result.css || result.css.length < 100) {
      console.error('[check-css] CSS compiled but output looks empty — aborting.')
      process.exit(1)
    }

    // Sanity: theme tokens must resolve into real color declarations
    const mustContain = ['--background', '--border', 'hsl(']
    for (const token of mustContain) {
      if (!result.css.includes(token)) {
        console.error(`[check-css] Compiled CSS missing expected token: ${token}`)
        process.exit(1)
      }
    }

    console.log(`[check-css] OK — compiled ${result.css.length.toLocaleString()} bytes from src/index.css`)
  } catch (err) {
    console.error('[check-css] FAILED — CSS will not load in the browser:')
    console.error(err?.message || err)
    process.exit(1)
  }
}

main()
