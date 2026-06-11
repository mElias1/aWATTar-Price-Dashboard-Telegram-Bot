import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    {
      name: 'telegram-send-endpoint',
      configureServer(server) {
        server.middlewares.use('/api/telegram/send', (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }

          execFile(
            'node',
            [
              ...(existsSync(resolve(process.cwd(), '.env')) ? ['--env-file=.env'] : []),
              resolve(process.cwd(), 'scripts/telegram.js'),
            ],
            { cwd: process.cwd() },
            (error, stdout, stderr) => {
              if (error) {
                console.error('telegram.js failed', stderr || error.message)
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: stderr || error.message }))
                return
              }

              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, output: stdout.trim() }))
            },
          )
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
