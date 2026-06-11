# awattar_bot

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

## Telegram Daily Bot (Backend Script)

The Telegram logic lives separately in `scripts/telegram.js`, not in the Vue frontend.

1. Create `.env`:

```sh
cp .env.example .env
```

2. Set the values in `.env`:

```env
BOT_TOKEN=...
CHAT_ID=...
PRICE_API_URL=https://api.awattar.at/v1/marketdata
```

3. Test manually:

```sh
npm run telegram:send
```

4. Cron (daily at 07:00):

```cron
0 7 * * * cd /ABSOLUTE/PATH/awattar_bot && /usr/bin/env npm run telegram:send >> ./telegram-cron.log 2>&1
```
